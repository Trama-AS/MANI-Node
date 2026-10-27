const ISolicitudAsignacionRepository = require('../../domain/ports/ISolicitudAsignacionRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const MAX_BANDEJA = 100;

// El aliado de la sesión, con su cuenta y su verificación (mismo criterio que la RPC 005 `_sol_aliado_actual`).
const ALIADO_SQL = `
  SELECT a.id, a.estado_verificacion, u.estado AS estado_usuario
  FROM aliado a
  JOIN usuario u ON u.id = a.usuario_id AND u.tenant_id = a.tenant_id
  WHERE a.usuario_id = $1 AND a.tenant_id = $2`;

// Categoría asignada y cobertura en la zona de la solicitud o en una zona ancestro (como la elegibilidad).
const ELEGIBLE_SQL = `
  WITH RECURSIVE ascendencia AS (
    SELECT z.id, z.zona_padre_id, 1 AS nivel FROM zona z WHERE z.id = $3
    UNION ALL
    SELECT z.id, z.zona_padre_id, a.nivel + 1
    FROM zona z JOIN ascendencia a ON z.id = a.zona_padre_id
    WHERE a.nivel < 10
  )
  SELECT EXISTS (
           SELECT 1 FROM aliado_categoria ac
           WHERE ac.aliado_id = $1 AND ac.tenant_id = $4 AND ac.categoria_id = $2
         )
     AND EXISTS (
           SELECT 1 FROM cobertura_aliado ca JOIN ascendencia asc_z ON asc_z.id = ca.zona_id
           WHERE ca.aliado_id = $1 AND ca.tenant_id = $4
         ) AS elegible`;

const OFERTA_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM notificacion n
    WHERE n.tenant_id = $1 AND n.usuario_id = $2 AND n.tipo = 'OFERTA_DESPACHO' AND n.payload->>'requestId' = $3
  ) AS tiene_oferta`;

// Misma forma que `_sol_json` de la RPC 005, en camelCase: la dirección y la fecha de asignación solo se ven
// cuando la solicitud es del aliado.
const BANDEJA_SQL = `
  SELECT s.id, s.estado, (s.aliado_id IS NOT DISTINCT FROM $3) AS es_mia,
         c.nombre AS categoria, c.flujo_operativo, z.nombre AS zona, zp.nombre AS zona_padre,
         COALESCE(si.reglas, '{}'::jsonb) AS reglas_sitio,
         CASE WHEN s.aliado_id = $3 THEN si.direccion END AS direccion,
         s.created_at,
         CASE WHEN s.aliado_id = $3 THEN s.updated_at END AS asignada_at
  FROM solicitud s
  JOIN categoria_servicio c ON c.id = s.categoria_id AND c.tenant_id = s.tenant_id
  JOIN zona z ON z.id = s.zona_id
  LEFT JOIN zona zp ON zp.id = z.zona_padre_id
  LEFT JOIN sitio si ON si.id = s.sitio_id AND si.tenant_id = s.tenant_id
  WHERE s.tenant_id = $1
    AND (
          (s.aliado_id = $3 AND s.estado <> 'CANCELADA')
       OR (
            s.estado = 'PENDIENTE' AND s.aliado_id IS NULL
            AND EXISTS (
              SELECT 1 FROM notificacion n
              WHERE n.tenant_id = s.tenant_id AND n.usuario_id = $2 AND n.tipo = 'OFERTA_DESPACHO'
                AND n.payload->>'requestId' = s.id::text
            )
          )
        )
  ORDER BY s.created_at, s.id
  LIMIT ${MAX_BANDEJA}`;

async function aliadoDeLaSesion(client, ctx) {
  const { rows } = await client.query(ALIADO_SQL, [ctx.userId, ctx.tenantId]);
  if (rows.length === 0 || rows[0].estado_usuario !== 'ACTIVO') {
    throw new ForbiddenError('MANI-SOL-403: solo un aliado activo puede gestionar solicitudes', 'MANI-SOL-403');
  }
  if (rows[0].estado_verificacion !== 'VERIFICADO') {
    throw new ForbiddenError('MANI-SOL-403V: tu registro como aliado aún no está verificado', 'MANI-SOL-403V');
  }
  return rows[0].id;
}

/**
 * Asignación y bandeja del aliado sobre `pg` con runInTenantContext (ADR-0032), como `mani_core_svc`.
 *
 * Concurrencia: la fila de la solicitud se bloquea con FOR UPDATE antes de decidir. Los aliados que aceptan a la
 * vez se atienden de a uno; el primero la asigna y los demás encuentran `aliado_id` ocupado (409). El UPDATE
 * repite el predicado `estado = 'PENDIENTE' AND aliado_id IS NULL`, que hace de versión de la fila.
 */
class PgSolicitudAsignacionRepository extends ISolicitudAsignacionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgSolicitudAsignacionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async asignar(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliadoId = await aliadoDeLaSesion(client, ctx);

      const actual = await client.query(
        `SELECT s.estado, s.aliado_id, s.categoria_id, s.zona_id, s.updated_at
         FROM solicitud s
         WHERE s.id = $1 AND s.tenant_id = $2
         FOR UPDATE`,
        [solicitudId, ctx.tenantId]
      );
      if (actual.rows.length === 0) throw new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404');
      const fila = actual.rows[0];

      // Reintento del mismo aliado (doble toque o red inestable): mismo resultado, sin efectos.
      if (fila.aliado_id === aliadoId) {
        return {
          solicitud: { id: solicitudId, estado: fila.estado, aliadoId, asignadaEn: fila.updated_at },
          asignada: false,
        };
      }
      // Sin el id del ganador: el aliado que perdió no necesita saber quién la tomó.
      if (fila.aliado_id) throw new ConflictError('MANI-SOL-409: la solicitud ya no está disponible', 'MANI-SOL-409');
      if (fila.estado !== 'PENDIENTE') {
        throw new ConflictError(`MANI-SOL-409E: una solicitud ${fila.estado} no se puede asignar`, 'MANI-SOL-409E');
      }

      const oferta = await client.query(OFERTA_SQL, [ctx.tenantId, ctx.userId, solicitudId]);
      if (!oferta.rows[0].tiene_oferta) {
        throw new ForbiddenError('MANI-SOL-403O: no recibiste una oferta para esta solicitud', 'MANI-SOL-403O');
      }
      const elegible = await client.query(ELEGIBLE_SQL, [aliadoId, fila.categoria_id, fila.zona_id, ctx.tenantId]);
      if (!elegible.rows[0].elegible) {
        throw new ForbiddenError('MANI-SOL-403E: no atiendes la categoría o la zona de esta solicitud', 'MANI-SOL-403E');
      }

      const cambio = await client.query(
        `UPDATE solicitud SET aliado_id = $3, estado = 'ASIGNADA', updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND estado = 'PENDIENTE' AND aliado_id IS NULL
         RETURNING updated_at`,
        [solicitudId, ctx.tenantId, aliadoId]
      );
      // Con la fila bloqueada no debería ocurrir; si ocurre, nadie quedó asignado por esta llamada.
      if (cambio.rowCount !== 1) throw new ConflictError('MANI-SOL-409: la solicitud ya no está disponible', 'MANI-SOL-409');

      // QS-12: el cambio de estado queda en la línea de tiempo y el cliente se entera (paridad con la RPC 005).
      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, 'SOLICITUD_ASIGNADA', 'El aliado aceptó el servicio.')`,
        [ctx.tenantId, solicitudId, ctx.userId]
      );
      await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
         SELECT $1, cl.usuario_id, 'SOLICITUD_ASIGNADA', 'IN_APP', $3::jsonb
         FROM solicitud s JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         WHERE s.id = $2 AND s.tenant_id = $1`,
        [ctx.tenantId, solicitudId, JSON.stringify({ requestId: solicitudId })]
      );

      return {
        solicitud: { id: solicitudId, estado: 'ASIGNADA', aliadoId, asignadaEn: cambio.rows[0].updated_at },
        asignada: true,
      };
    });
  }

  async ofertasDelAliado(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliadoId = await aliadoDeLaSesion(client, ctx);
      const { rows } = await client.query(BANDEJA_SQL, [ctx.tenantId, ctx.userId, aliadoId]);
      return rows.map((r) => ({
        id: r.id,
        estado: r.estado,
        esMia: r.es_mia,
        categoria: r.categoria,
        flujoOperativo: r.flujo_operativo,
        zona: r.zona,
        zonaPadre: r.zona_padre,
        reglasSitio: r.reglas_sitio,
        direccion: r.direccion,
        creadaEn: r.created_at,
        asignadaEn: r.asignada_at,
      }));
    });
  }
}

module.exports = PgSolicitudAsignacionRepository;
