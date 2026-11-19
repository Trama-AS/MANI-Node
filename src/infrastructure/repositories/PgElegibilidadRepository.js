const IElegibilidadRepository = require('../../domain/ports/IElegibilidadRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Una sola consulta: devuelve siempre una fila con el total y la página (aunque la página pedida esté vacía). La
// cobertura declarada en una zona cubre también a sus descendientes: se sube por zona_padre_id. El orden es por id,
// estable para paginar; el ranking del listado es de Rules (ADR-0022).
//
// Corre dentro de runInTenantContext (ADR-0032): con el rol mani_core_svc (NOBYPASSRLS) las políticas
// de la migración 0007 solo dejan ver filas del tenant fijado con app.set_context.
// No lee solicitud_rechazo: esa tabla es del dominio de Dispatch (ADR-0030, T1).
// SCRUM-876 (HU-M08-04): incluye calificación agregada por aliado dentro del tenant (sin valorar = null, nunca 0 ficticio).
// SCRUM-1462: incluye las zonas de cobertura del aliado en zonas activas del tenant, para el criterio COBERTURA de Rules.
//
// Los CTE de elegibilidad se arman con `ctesElegibles` para que las dos consultas compartan exactamente el mismo
// filtro. Lo que se interpola son fragmentos fijos de este archivo (placeholders y subconsultas), nunca datos: los
// valores siempre viajan como parámetros.
function ctesElegibles({ tenant, zona, categoria, tipo, excluir, offset, limit }) {
  return `
  ascendencia AS (
    SELECT z.id, z.zona_padre_id, 1 AS nivel FROM zona z WHERE z.id = ${zona}
    UNION ALL
    SELECT z.id, z.zona_padre_id, a.nivel + 1
    FROM zona z JOIN ascendencia a ON z.id = a.zona_padre_id
    WHERE a.nivel < 10
  ),
  elegibles AS (
    SELECT DISTINCT a.id, a.usuario_id, a.tenant_id, a.nombre_razon_social, a.tipo, a.estado_verificacion
    FROM aliado a
    JOIN usuario u ON u.id = a.usuario_id AND u.tenant_id = a.tenant_id AND u.estado = 'ACTIVO'
    JOIN aliado_categoria ac ON ac.aliado_id = a.id AND ac.tenant_id = a.tenant_id
    JOIN categoria_servicio cs ON cs.id = ac.categoria_id AND cs.tenant_id = a.tenant_id AND cs.estado = 'ACTIVO'
    JOIN cobertura_aliado ca ON ca.aliado_id = a.id AND ca.tenant_id = a.tenant_id
    JOIN ascendencia asc_z ON asc_z.id = ca.zona_id
    JOIN zona z ON z.id = ca.zona_id AND upper(btrim(coalesce(z.estado, ''))) IN ('ACTIVO', 'ACTIVA')
    WHERE a.tenant_id = ${tenant}
      AND ac.categoria_id = ${categoria}
      AND a.estado_verificacion = 'VERIFICADO'
      AND (${tipo}::text IS NULL OR a.tipo = ${tipo}::text)
      ${excluir}
      AND NOT EXISTS (
        SELECT 1 FROM aliado_ausencia aa
        WHERE aa.aliado_id = a.id AND aa.tenant_id = a.tenant_id
          AND aa.inicio <= now() AND aa.fin > now()
      )
  ),
  pagina AS (
    SELECT e.id, e.nombre_razon_social, e.tipo, e.estado_verificacion,
           (SELECT COUNT(cal.id)::int
            FROM calificacion cal
            JOIN solicitud s ON s.id = cal.solicitud_id AND s.tenant_id = cal.tenant_id
            WHERE cal.tenant_id = e.tenant_id
              AND cal.destinatario_id = e.usuario_id
              AND s.estado IN ('FINALIZADA', 'CERRADA')) AS total_calificaciones,
           (SELECT CASE WHEN COUNT(cal.id) > 0 THEN ROUND(AVG(cal.puntaje)::numeric, 2)::float8 ELSE NULL END
            FROM calificacion cal
            JOIN solicitud s ON s.id = cal.solicitud_id AND s.tenant_id = cal.tenant_id
            WHERE cal.tenant_id = e.tenant_id
              AND cal.destinatario_id = e.usuario_id
              AND s.estado IN ('FINALIZADA', 'CERRADA')) AS calificacion_promedio,
           (SELECT COUNT(*)::int
            FROM cobertura_aliado cob
            JOIN zona zc ON zc.id = cob.zona_id AND upper(btrim(coalesce(zc.estado, ''))) IN ('ACTIVO', 'ACTIVA')
            WHERE cob.aliado_id = e.id
              AND cob.tenant_id = e.tenant_id) AS zonas_cobertura
    FROM elegibles e
    ORDER BY e.id OFFSET ${offset} LIMIT ${limit}
  )`;
}

const TOTAL_Y_PAGINA = `
    (SELECT count(*)::int FROM elegibles) AS total,
    COALESCE(
      (SELECT json_agg(p ORDER BY p.id) FROM pagina p),
      '[]'::json
    ) AS allies`;

// Dispatch envía en $5 los aliados que ya rechazaron y se excluyen antes de paginar, para que totalCount sea exacto.
const FIND_ELIGIBLE_SQL = `
  WITH RECURSIVE ${ctesElegibles({
    tenant: '$1',
    categoria: '$2',
    zona: '$3',
    tipo: '$4',
    excluir: 'AND NOT (a.id = ANY($5::uuid[]))',
    offset: '$6',
    limit: '$7',
  })}
  SELECT ${TOTAL_Y_PAGINA}`;

// SCRUM-1652: contexto de la solicitud, elegibles y criterio de orden del tenant en una sola sentencia, para que
// Dispatch arme eligible-allies con un viaje a Core en vez de tres. Quién ve la solicitud es lo mismo que en
// /solicitudes/{id}/context para el admin y el cliente dueño. Zona y categoría salen de la solicitud, nunca de la
// consulta. Sin la solicitud visible, `solicitud` es null y no hay elegibles. No excluye rechazos: Dispatch los
// descuenta, porque solicitud_rechazo es de su dominio (ADR-0030) y así los lee en paralelo con esta consulta.
const FIND_ELIGIBLE_FOR_REQUEST_SQL = `
  WITH RECURSIVE sol AS (
    SELECT s.id, s.zona_id, s.categoria_id, s.estado
    FROM solicitud s
    JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
    WHERE s.id = $2 AND s.tenant_id = $1
      AND ($3 = 'ADMIN' OR ($3 = 'CLIENT' AND c.usuario_id = $4))
  ),
  ${ctesElegibles({
    tenant: '$1',
    categoria: '(SELECT categoria_id FROM sol)',
    zona: '(SELECT zona_id FROM sol)',
    tipo: '$5',
    excluir: '',
    offset: '$6',
    limit: '$7',
  })}
  SELECT
    (SELECT row_to_json(sol) FROM sol) AS solicitud,
    EXISTS (SELECT 1 FROM regla_tenant rt WHERE rt.tenant_id = $1 AND rt.estado = 'VIGENTE') AS tiene_regla_propia,
    (SELECT rt.reglas -> 'ordenListado' ->> 'criterio'
     FROM regla_tenant rt WHERE rt.tenant_id = $1 AND rt.estado = 'VIGENTE') AS criterio_orden_listado,
    ${TOTAL_Y_PAGINA}`;

function toAlly(row) {
  const totalCalificaciones = Number(row.total_calificaciones || 0);
  const calificacionPromedio =
    totalCalificaciones > 0 && row.calificacion_promedio !== null && row.calificacion_promedio !== undefined
      ? Number(row.calificacion_promedio)
      : null;
  return {
    id: row.id,
    nombreRazonSocial: row.nombre_razon_social,
    tipo: row.tipo,
    estadoVerificacion: row.estado_verificacion,
    calificacionPromedio,
    totalCalificaciones,
    etiquetaCalificacion:
      totalCalificaciones > 0 ? `${calificacionPromedio.toFixed(1)} (${totalCalificaciones})` : 'Sin valorar',
    zonasCobertura: row.zonas_cobertura,
  };
}

class PgElegibilidadRepository extends IElegibilidadRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgElegibilidadRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findEligible(ctx, { categoriaId, zonaId, excludeAllyIds = [], tipo = null, page, pageSize }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(FIND_ELIGIBLE_SQL, [
        ctx.tenantId, categoriaId, zonaId, tipo, excludeAllyIds, (page - 1) * pageSize, pageSize,
      ]);

      return {
        allies: rows[0].allies.map(toAlly),
        totalCount: rows[0].total,
      };
    });
  }

  /**
   * Contexto, elegibles y criterio de orden de una solicitud en una sola sentencia (SCRUM-1652).
   * @returns {Promise<null | { solicitud: object, criterioOrdenListado: string|null, tieneReglaPropia: boolean,
   *   allies: object[], totalCount: number }>} null si la sesión no puede ver la solicitud.
   */
  async findEligibleForRequest(ctx, { solicitudId, tipo = null, page, pageSize }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(FIND_ELIGIBLE_FOR_REQUEST_SQL, [
        ctx.tenantId, solicitudId, ctx.role, ctx.userId, tipo, (page - 1) * pageSize, pageSize,
      ]);
      const row = rows[0];
      if (!row.solicitud) return null;

      return {
        solicitud: {
          id: row.solicitud.id,
          zonaId: row.solicitud.zona_id,
          categoriaId: row.solicitud.categoria_id,
          estado: row.solicitud.estado,
        },
        tieneReglaPropia: row.tiene_regla_propia,
        criterioOrdenListado: row.criterio_orden_listado,
        allies: row.allies.map(toAlly),
        totalCount: row.total,
      };
    });
  }
}

module.exports = PgElegibilidadRepository;
