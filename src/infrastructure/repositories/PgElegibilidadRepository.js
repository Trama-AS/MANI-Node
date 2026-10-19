const IElegibilidadRepository = require('../../domain/ports/IElegibilidadRepository');
const requirePool = require('../db/requirePool');

// La cobertura declarada en una zona cubre también a sus descendientes: se sube por zona_padre_id.
const ELIGIBLE_FROM = `
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
    JOIN aliado_categoria ac ON ac.aliado_id = a.id AND ac.tenant_id = a.tenant_id
    JOIN cobertura_aliado ca ON ca.aliado_id = a.id AND ca.tenant_id = a.tenant_id
    JOIN ascendencia asc_z ON asc_z.id = ca.zona_id
    JOIN zona z ON z.id = ca.zona_id AND z.estado = 'ACTIVO'
    WHERE a.tenant_id = $1
      AND ac.categoria_id = $2
      AND a.estado_verificacion = 'VERIFICADO'
      AND ($4::text IS NULL OR a.tipo = $4::text)
      AND NOT EXISTS (
        SELECT 1 FROM aliado_ausencia aa
        WHERE aa.aliado_id = a.id AND aa.tenant_id = a.tenant_id
          AND aa.inicio <= now() AND aa.fin > now()
      )
      AND ($5::uuid IS NULL OR NOT EXISTS (
        SELECT 1 FROM solicitud_rechazo r
        WHERE r.solicitud_id = $5::uuid AND r.aliado_id = a.id AND r.tenant_id = a.tenant_id
      ))
  )`;

class PgElegibilidadRepository extends IElegibilidadRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgElegibilidadRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findEligible({ tenantId, categoriaId, zonaId, requestId = null, tipo = null, page, pageSize }) {
    const pool = requirePool(this.pgPoolFactory);
    const base = [tenantId, categoriaId, zonaId, tipo, requestId];

    const count = await pool.query(`${ELIGIBLE_FROM} SELECT count(*)::int AS total FROM elegibles`, base);
    const rows = await pool.query(
      `${ELIGIBLE_FROM}
       SELECT id, nombre_razon_social, tipo, estado_verificacion
       FROM elegibles
       ORDER BY id
       OFFSET $6 LIMIT $7`,
      [...base, (page - 1) * pageSize, pageSize]
    );

    return {
      allies: rows.rows.map((row) => ({
        id: row.id,
        nombreRazonSocial: row.nombre_razon_social,
        tipo: row.tipo,
        estadoVerificacion: row.estado_verificacion,
      })),
      totalCount: count.rows[0].total,
    };
  }
}

module.exports = PgElegibilidadRepository;
