const { ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { aliadoDeSesion, clienteActivoDeSesion } = require('./sesionActores');
const { comisionVigente, COMISION_POR_DEFECTO } = require('./fondosEnGarantia');

const noEsCliente = () => new ForbiddenError('MANI-PAG-403C: solo un cliente activo consulta sus pagos', 'MANI-PAG-403C');
const noEsAliado = () => new ForbiddenError('MANI-FON-403A: solo un aliado consulta sus cobros', 'MANI-FON-403A');
// Un pago de otro cliente o sin retención responde igual que uno inexistente: no se revela que existe.
const noEncontrada = () => new NotFoundError('MANI-FON-404: retención no encontrada', 'MANI-FON-404');

const numero = (v) => (v === null || v === undefined ? null : Number(v));

function toRetencion(r) {
  return {
    id: r.id,
    pagoId: r.pago_id,
    solicitudId: r.solicitud_id,
    monto: numero(r.monto),
    moneda: r.moneda,
    estado: r.estado,
    simulada: r.simulada,
    creadaEn: r.created_at,
    liberadaEn: r.liberada_at ?? null,
  };
}

/**
 * Lecturas de la retención, la liquidación y la comisión (SCRUM-891 a 894) sobre `pg`, en runInTenantContext
 * (ADR-0032). Las escrituras de retención y liquidación van en las transacciones del pago y de la finalización
 * (fondosEnGarantia.js); aquí solo se lee y se configura la comisión.
 */
class PgFondosRepository {
  constructor({ pgPoolFactory }) {
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgFondosRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  /** Retención del pago, solo para el cliente que pagó. */
  retencionDelPago(ctx, pagoId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivoDeSesion(client, ctx, noEsCliente);
      const { rows } = await client.query(
        `SELECT r.id, r.pago_id, r.solicitud_id, r.monto, r.moneda, r.estado, r.simulada, r.created_at, r.liberada_at
         FROM retencion_fondos r
         JOIN pago p ON p.id = r.pago_id AND p.tenant_id = r.tenant_id
         WHERE r.pago_id = $1 AND r.tenant_id = $2 AND p.cliente_id = $3`,
        [pagoId, ctx.tenantId, clienteId]
      );
      if (rows.length === 0) throw noEncontrada();
      return toRetencion(rows[0]);
    });
  }

  /** Cobros del aliado de la sesión (SCRUM-894): retención y, si ya se liberó, su liquidación. Más recientes primero. */
  cobrosDelAliado(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliadoId = await aliadoDeSesion(client, ctx, noEsAliado);
      const { rows } = await client.query(
        `SELECT r.id, r.pago_id, r.solicitud_id, r.monto, r.moneda, r.estado, r.simulada, r.created_at, r.liberada_at,
                l.id AS liquidacion_id, l.porcentaje_comision, l.comision, l.monto_neto
         FROM retencion_fondos r
         LEFT JOIN liquidacion l ON l.retencion_id = r.id AND l.tenant_id = r.tenant_id
         WHERE r.aliado_id = $1 AND r.tenant_id = $2
         ORDER BY r.created_at DESC, r.id
         LIMIT 100`,
        [aliadoId, ctx.tenantId]
      );
      return rows.map((r) => ({
        ...toRetencion(r),
        liquidacion: r.liquidacion_id
          ? {
              id: r.liquidacion_id,
              montoBruto: numero(r.monto),
              porcentajeComision: numero(r.porcentaje_comision),
              comision: numero(r.comision),
              montoNeto: numero(r.monto_neto),
            }
          : null,
      }));
    });
  }

  /** Comisión vigente del tenant y si es la configurada o el valor por defecto. */
  obtenerComision(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const porcentaje = await comisionVigente(client, ctx.tenantId);
      return { porcentaje, porDefecto: porcentaje === COMISION_POR_DEFECTO && !(await this.#configurada(client, ctx)) };
    });
  }

  async #configurada(client, ctx) {
    const { rowCount } = await client.query('SELECT 1 FROM comision_tenant WHERE tenant_id = $1', [ctx.tenantId]);
    return rowCount > 0;
  }

  /** Fija el porcentaje del tenant (0 a 100). Solo afecta las liquidaciones futuras: las ya generadas no cambian. */
  fijarComision(ctx, porcentaje) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await client.query(
        `INSERT INTO comision_tenant (tenant_id, porcentaje, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET porcentaje = EXCLUDED.porcentaje, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [ctx.tenantId, porcentaje, ctx.userId]
      );
      return { porcentaje, porDefecto: false };
    });
  }
}

module.exports = PgFondosRepository;
