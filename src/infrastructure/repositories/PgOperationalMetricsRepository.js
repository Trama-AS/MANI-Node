const IOperationalMetricsRepository = require('../../domain/ports/IOperationalMetricsRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Periodo [desde, hasta] inclusive en hora de Colombia, comparado contra marcas TIMESTAMPTZ.
const EN_PERIODO = (columna) =>
  `${columna} >= ($2::date::timestamp AT TIME ZONE 'America/Bogota') AND ${columna} < (($3::date + 1)::timestamp AT TIME ZONE 'America/Bogota')`;

/**
 * Agregados operativos de un tenant (SCRUM-900) en una sola consulta dentro de withTenantContext (ADR-0032).
 * Cada subconsulta filtra por el tenant del JWT además de RLS: un tenant nunca suma filas de otro (C3).
 */
class PgOperationalMetricsRepository extends IOperationalMetricsRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgOperationalMetricsRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async agregados(ctx, { desde, hasta }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `WITH sol AS (
           SELECT estado, aliado_id FROM solicitud WHERE tenant_id = $1 AND ${EN_PERIODO('created_at')}
         ), cot AS (
           SELECT estado FROM cotizacion WHERE tenant_id = $1 AND ${EN_PERIODO('created_at')}
         ), pag AS (
           SELECT monto FROM pago WHERE tenant_id = $1 AND estado = 'APROBADO' AND ${EN_PERIODO('created_at')}
         ), cal AS (
           SELECT puntaje FROM calificacion WHERE tenant_id = $1 AND ${EN_PERIODO('created_at')}
         ), qja AS (
           SELECT estado FROM queja WHERE tenant_id = $1 AND ${EN_PERIODO('created_at')}
         )
         SELECT
           (SELECT count(*)::int FROM sol) AS solicitudes_creadas,
           (SELECT coalesce(jsonb_object_agg(estado, n), '{}'::jsonb)
              FROM (SELECT estado, count(*)::int AS n FROM sol GROUP BY estado) e) AS solicitudes_por_estado,
           (SELECT count(*)::int FROM sol WHERE estado IN ('FINALIZADA', 'CERRADA')) AS solicitudes_finalizadas,
           (SELECT count(*)::int FROM sol WHERE estado = 'CANCELADA') AS solicitudes_canceladas,
           (SELECT count(DISTINCT aliado_id)::int FROM sol WHERE aliado_id IS NOT NULL) AS aliados_con_servicios,
           (SELECT count(*)::int FROM cot) AS cotizaciones_emitidas,
           (SELECT count(*)::int FROM cot WHERE estado = 'ACEPTADA') AS cotizaciones_aceptadas,
           (SELECT count(*)::int FROM pag) AS pagos_aprobados,
           (SELECT coalesce(sum(monto), 0) FROM pag) AS monto_aprobado,
           (SELECT count(*)::int FROM cal) AS calificaciones,
           (SELECT round(avg(puntaje)::numeric, 2) FROM cal) AS calificacion_promedio,
           (SELECT count(*)::int FROM qja) AS quejas_registradas,
           (SELECT count(*)::int FROM qja WHERE estado IN ('ABIERTA', 'EN_REVISION')) AS quejas_abiertas,
           (SELECT count(*)::int FROM qja WHERE estado IN ('RESUELTA', 'RECHAZADA')) AS quejas_cerradas`,
        [ctx.tenantId, desde, hasta]
      );
      const r = rows[0];
      return {
        solicitudesCreadas: r.solicitudes_creadas,
        solicitudesPorEstado: r.solicitudes_por_estado,
        solicitudesFinalizadas: r.solicitudes_finalizadas,
        solicitudesCanceladas: r.solicitudes_canceladas,
        aliadosConServicios: r.aliados_con_servicios,
        cotizacionesEmitidas: r.cotizaciones_emitidas,
        cotizacionesAceptadas: r.cotizaciones_aceptadas,
        pagosAprobados: r.pagos_aprobados,
        montoAprobado: Number(r.monto_aprobado),
        calificaciones: r.calificaciones,
        calificacionPromedio: r.calificacion_promedio === null ? null : Number(r.calificacion_promedio),
        quejasRegistradas: r.quejas_registradas,
        quejasAbiertas: r.quejas_abiertas,
        quejasCerradas: r.quejas_cerradas,
      };
    });
  }
}

module.exports = PgOperationalMetricsRepository;
