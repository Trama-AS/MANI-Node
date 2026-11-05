const ITransactionAuditRepository = require('../../domain/ports/ITransactionAuditRepository');
const { NotFoundError, ValidationError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { clienteActivoDeSesion } = require('./sesionActores');

const COLUMNAS = 'e.id, e.pago_id, e.tipo, e.estado, e.monto, e.moneda, e.actor_id, e.actor_rol, e.correlation_id, e.created_at';

function toEvent(row) {
  return {
    id: row.id,
    pagoId: row.pago_id,
    tipo: row.tipo,
    estado: row.estado,
    monto: Number(row.monto),
    moneda: row.moneda,
    actor: { id: row.actor_id, rol: row.actor_rol },
    correlationId: row.correlation_id,
    creadoEn: row.created_at,
  };
}

// Un pago ajeno responde igual que uno inexistente: no se revela que existe.
const noEncontrado = () => new NotFoundError('MANI-AUD-404: pago no encontrado', 'MANI-AUD-404');
const sinPerfil = noEncontrado;

/**
 * Consulta del registro de transacciones sobre `pg`. Toda consulta filtra por el tenant del JWT además de RLS, y el
 * cursor se compara dentro de SQL para conservar los microsegundos de `created_at`.
 */
class PgTransactionAuditRepository extends ITransactionAuditRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgTransactionAuditRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async listarPorPago(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows: pago } = await client.query('SELECT cliente_id FROM pago WHERE id = $1 AND tenant_id = $2', [
        datos.pagoId,
        ctx.tenantId,
      ]);
      if (pago.length === 0) throw noEncontrado();
      if (ctx.role === 'CLIENT') {
        const clienteId = await clienteActivoDeSesion(client, ctx, sinPerfil);
        if (pago[0].cliente_id !== clienteId) throw noEncontrado();
      }
      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM transaccion_evento e
         WHERE e.pago_id = $1 AND e.tenant_id = $2
         ORDER BY e.created_at, e.id`,
        [datos.pagoId, ctx.tenantId]
      );
      return { eventos: rows.map(toEvent) };
    });
  }

  async listar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const params = [ctx.tenantId, datos.limite];
      let filtroCursor = '';
      if (datos.despuesDe) {
        const { rows } = await client.query('SELECT 1 FROM transaccion_evento WHERE id = $1 AND tenant_id = $2', [
          datos.despuesDe,
          ctx.tenantId,
        ]);
        if (rows.length === 0) {
          throw new ValidationError('MANI-AUD-400: despuesDe no es un evento de este tenant', 'MANI-AUD-400');
        }
        params.push(datos.despuesDe);
        filtroCursor = `AND (e.created_at, e.id) > (SELECT c.created_at, c.id FROM transaccion_evento c WHERE c.id = $${params.length})`;
      }
      let filtroPago = '';
      if (datos.pagoId) {
        params.push(datos.pagoId);
        filtroPago = `AND e.pago_id = $${params.length}`;
      }
      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM transaccion_evento e
         WHERE e.tenant_id = $1 ${filtroCursor} ${filtroPago}
         ORDER BY e.created_at, e.id
         LIMIT $2`,
        params
      );
      return { eventos: rows.map(toEvent) };
    });
  }
}

module.exports = PgTransactionAuditRepository;
