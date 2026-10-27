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
const FIND_ELIGIBLE_SQL = `
  WITH RECURSIVE ascendencia AS (
    SELECT z.id, z.zona_padre_id, 1 AS nivel FROM zona z WHERE z.id = $3
    UNION ALL
    SELECT z.id, z.zona_padre_id, a.nivel + 1
    FROM zona z JOIN ascendencia a ON z.id = a.zona_padre_id
    WHERE a.nivel < 10
  ),
  elegibles AS (
    SELECT DISTINCT a.id, a.nombre_razon_social, a.tipo, a.estado_verificacion
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
  )
  SELECT
    (SELECT count(*)::int FROM elegibles) AS total,
    COALESCE(
      (SELECT json_agg(p ORDER BY p.id)
       FROM (SELECT id, nombre_razon_social, tipo, estado_verificacion
             FROM elegibles ORDER BY id OFFSET $6 LIMIT $7) p),
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
        allies: rows[0].allies.map((row) => ({
          id: row.id,
          nombreRazonSocial: row.nombre_razon_social,
          tipo: row.tipo,
          estadoVerificacion: row.estado_verificacion,
        })),
        totalCount: rows[0].total,
      };
    });
  }
}

module.exports = PgElegibilidadRepository;
