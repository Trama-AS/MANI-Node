const IElegibilidadRepository = require('../../domain/ports/IElegibilidadRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Una sola consulta, sin construir SQL por interpolación: devuelve siempre una fila con el total
// y la página (aunque la página pedida esté vacía). La cobertura declarada en una zona cubre también
// a sus descendientes: se sube por zona_padre_id. El orden es por id, estable para paginar; el
// ranking del listado es de Rules (ADR-0022).
//
// Corre dentro de runInTenantContext (ADR-0032): con el rol mani_core_svc (NOBYPASSRLS) las políticas
// de la migración 0007 solo dejan ver filas del tenant fijado con app.set_context.
// No lee solicitud_rechazo: esa tabla es del dominio de Dispatch (ADR-0030, T1). Dispatch envía los
// aliados que ya rechazaron en $5 y se excluyen antes de paginar, para que totalCount sea exacto.
// SCRUM-876 (HU-M08-04): incluye calificación agregada por aliado dentro del tenant (sin valorar = null, nunca 0 ficticio).
const FIND_ELIGIBLE_SQL = `
  WITH RECURSIVE ascendencia AS (
    SELECT z.id, z.zona_padre_id, 1 AS nivel FROM zona z WHERE z.id = $3
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
    WHERE a.tenant_id = $1
      AND ac.categoria_id = $2
      AND a.estado_verificacion = 'VERIFICADO'
      AND ($4::text IS NULL OR a.tipo = $4::text)
      AND NOT (a.id = ANY($5::uuid[]))
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
              AND s.estado IN ('FINALIZADA', 'CERRADA')) AS calificacion_promedio
    FROM elegibles e
    ORDER BY e.id OFFSET $6 LIMIT $7
  )
  SELECT
    (SELECT count(*)::int FROM elegibles) AS total,
    COALESCE(
      (SELECT json_agg(p ORDER BY p.id) FROM pagina p),
      '[]'::json
    ) AS allies`;

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
        allies: rows[0].allies.map((row) => {
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
          };
        }),
        totalCount: rows[0].total,
      };
    });
  }
}

module.exports = PgElegibilidadRepository;
