const IPaymentRepository = require('../../domain/ports/IPaymentRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { clienteActivoDeSesion } = require('./sesionActores');
const { registrarEventoTransaccion } = require('./transaccionEvento');
const { ADICIONES_ACEPTADAS_SQL } = require('./totalVigente');

const UNIQUE_VIOLATION = '23505';
const MONEDA = 'COP';

const COLUMNAS = `id, cotizacion_id, monto, moneda, estado, proveedor, simulado, referencia_proveedor, motivo,
  correlation_id, created_at`;

function toPayment(row) {
  return {
    id: row.id,
    cotizacionId: row.cotizacion_id,
    monto: Number(row.monto),
    moneda: row.moneda,
    estado: row.estado,
    proveedor: row.proveedor,
    simulado: row.simulado,
    referenciaProveedor: row.referencia_proveedor,
    motivo: row.motivo,
    correlationId: row.correlation_id,
    creadoEn: row.created_at,
  };
}

const sinPerfil = () => new ForbiddenError('MANI-PAG-403C: solo un cliente activo realiza pagos', 'MANI-PAG-403C');
// Una cotización o un pago de otro cliente responde igual que uno inexistente: no se revela que existe.
const noEncontrado = () => new NotFoundError('MANI-PAG-404: pago o cotización no encontrados', 'MANI-PAG-404');
const yaAprobado = () =>
  new ConflictError('MANI-PAG-409A: la cotización ya tiene un pago aprobado', 'MANI-PAG-409A');

/**
 * Pagos del sandbox sobre `pg`, dentro de transacciones con withTenantContext (ADR-0032). El proveedor se llama
 * entre `prepararCobro` y `registrar`, fuera de toda transacción: no se mantienen bloqueos mientras se espera a un
 * tercero. Los índices únicos de la migración 0015 son la garantía final contra el doble cobro.
 */
class PgPaymentRepository extends IPaymentRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgPaymentRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async prepararCobro(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivoDeSesion(client, ctx, sinPerfil);

      if (datos.claveIdempotencia) {
        const previo = await client.query(
          `SELECT ${COLUMNAS} FROM pago
           WHERE tenant_id = $1 AND cotizacion_id = $2 AND clave_idempotencia = $3 AND cliente_id = $4`,
          [ctx.tenantId, datos.cotizacionId, datos.claveIdempotencia, clienteId]
        );
        if (previo.rows.length > 0) return { existente: toPayment(previo.rows[0]) };
      }

      // El monto es el total vigente (SCRUM-872): la cotización aceptada más sus adiciones aceptadas.
      const fila = await client.query(
        `SELECT cot.estado, cot.solicitud_id,
                (cot.valor_mano_obra + cot.valor_materiales + ${ADICIONES_ACEPTADAS_SQL})::numeric(12,2) AS monto
         FROM cotizacion cot
         JOIN solicitud s ON s.id = cot.solicitud_id AND s.tenant_id = cot.tenant_id
         WHERE cot.id = $1 AND cot.tenant_id = $2 AND s.cliente_id = $3`,
        [datos.cotizacionId, ctx.tenantId, clienteId]
      );
      if (fila.rows.length === 0) throw noEncontrado();
      const { estado, solicitud_id: solicitudId, monto } = fila.rows[0];
      if (estado !== 'ACEPTADA') {
        throw new ConflictError(
          `MANI-PAG-409E: la cotización en estado ${estado} no admite pago; debe estar aceptada`,
          'MANI-PAG-409E'
        );
      }

      const aprobado = await client.query(
        "SELECT 1 FROM pago WHERE cotizacion_id = $1 AND tenant_id = $2 AND estado = 'APROBADO'",
        [datos.cotizacionId, ctx.tenantId]
      );
      if (aprobado.rows.length > 0) throw yaAprobado();

      return { cobro: { cotizacionId: datos.cotizacionId, solicitudId, clienteId, monto: Number(monto), moneda: MONEDA } };
    });
  }

  async registrar(ctx, datos) {
    try {
      return await runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
        const creado = await client.query(
          `INSERT INTO pago (tenant_id, cotizacion_id, cliente_id, monto, moneda, estado, proveedor, simulado,
                             referencia_proveedor, motivo, correlation_id, clave_idempotencia)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING ${COLUMNAS}`,
          [
            ctx.tenantId,
            datos.cotizacionId,
            datos.clienteId,
            datos.monto,
            datos.moneda,
            datos.estado,
            datos.proveedor,
            datos.simulado,
            datos.referenciaProveedor,
            datos.motivo || null,
            datos.correlationId || null,
            datos.claveIdempotencia,
          ]
        );
        const pago = toPayment(creado.rows[0]);
        // Registro inmutable (SCRUM-889): en la misma transacción, así el pago y su evento nacen juntos o no nacen.
        await registrarEventoTransaccion(client, ctx, {
          pagoId: pago.id,
          tipo: 'PAGO_REGISTRADO',
          estado: pago.estado,
          monto: pago.monto,
          moneda: pago.moneda,
          correlationId: datos.correlationId,
        });
        return { pago, creado: true };
      });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      // Dos pagos con la misma clave en paralelo, o un segundo cobro aprobado: los índices únicos deciden.
      if (err.constraint === 'ux_pago_aprobado_por_cotizacion') throw yaAprobado();
      const { existente } = await this.prepararCobro(ctx, {
        cotizacionId: datos.cotizacionId,
        claveIdempotencia: datos.claveIdempotencia,
      }).catch(() => ({}));
      if (existente) return { pago: existente, creado: false };
      throw err;
    }
  }

  async obtener(ctx, pagoId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivoDeSesion(client, ctx, sinPerfil);
      const { rows } = await client.query(
        `SELECT ${COLUMNAS}, cliente_id FROM pago WHERE id = $1 AND tenant_id = $2`,
        [pagoId, ctx.tenantId]
      );
      if (rows.length === 0 || rows[0].cliente_id !== clienteId) throw noEncontrado();
      return toPayment(rows[0]);
    });
  }
}

module.exports = PgPaymentRepository;
