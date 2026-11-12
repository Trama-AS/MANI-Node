const IPaymentRepository = require('../../domain/ports/IPaymentRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { clienteActivoDeSesion } = require('./sesionActores');
const { registrarEventoTransaccion } = require('./transaccionEvento');
const { retenerPago, liberarYLiquidar } = require('./fondosEnGarantia');
const { construirPagoRegistrado } = require('../../domain/events/pagoRegistrado');
const { escribirEnOutbox } = require('../events/outboxEventos');
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
// SCRUM-1653: la misma clave con otro contenido no es un reintento.
const claveReutilizada = () =>
  new ConflictError(
    'MANI-PAG-409K: la clave de idempotencia ya se usó con otra cotización o con otro escenario',
    'MANI-PAG-409K'
  );

// Una fila sin huella (anterior a la 0041) se compara solo por cotización; con huella, el cuerpo entero debe coincidir.
function exigirMismoCuerpo(previo, datos) {
  if (previo.cotizacion_id !== datos.cotizacionId) throw claveReutilizada();
  if (previo.huella_idempotencia && datos.huella && previo.huella_idempotencia !== datos.huella) throw claveReutilizada();
}

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
        // La clave es del cliente: se busca por clave y no por cotización, para detectar que se reutilizó con otra.
        const previo = await client.query(
          `SELECT ${COLUMNAS}, huella_idempotencia FROM pago
           WHERE tenant_id = $1 AND clave_idempotencia = $2 AND cliente_id = $3
           ORDER BY created_at LIMIT 1`,
          [ctx.tenantId, datos.claveIdempotencia, clienteId]
        );
        if (previo.rows.length > 0) {
          exigirMismoCuerpo(previo.rows[0], datos);
          return { existente: toPayment(previo.rows[0]) };
        }
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
                             referencia_proveedor, motivo, correlation_id, clave_idempotencia, huella_idempotencia)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
            datos.claveIdempotencia ? datos.huella || null : null,
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
        // SCRUM-891: un pago aprobado retiene su monto en garantía, en la misma transacción.
        const retencionId = await retenerPago(client, ctx, pago);
        // SCRUM-892: si el cliente paga cuando el servicio ya terminó, la condición de cierre ya se cumplió y no habrá
        // otra transición a FINALIZADA que libere la retención: se libera y liquida aquí, en la misma transacción.
        if (retencionId) {
          const { rows: sol } = await client.query(
            `SELECT s.id, s.estado FROM solicitud s JOIN cotizacion c ON c.solicitud_id = s.id AND c.tenant_id = s.tenant_id
             WHERE c.id = $1 AND c.tenant_id = $2`,
            [datos.cotizacionId, ctx.tenantId]
          );
          if (sol.length > 0 && ['FINALIZADA', 'CERRADA'].includes(sol[0].estado)) {
            await liberarYLiquidar(client, ctx, sol[0].id);
          }
        }
        // SCRUM-889: el evento `PagoRegistrado` va al outbox en la misma transacción (ADR-0029); el relay lo publica.
        const { rows: agregados } = await client.query(
          'SELECT solicitud_id, aliado_id FROM cotizacion WHERE id = $1 AND tenant_id = $2',
          [datos.cotizacionId, ctx.tenantId]
        );
        await escribirEnOutbox(
          client,
          ctx,
          construirPagoRegistrado({
            pago,
            agregados: { solicitudId: agregados[0].solicitud_id, aliadoId: agregados[0].aliado_id, clienteId: datos.clienteId },
            correlationId: datos.correlationId,
          })
        );
        return { pago, creado: true };
      });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      // Dos pagos con la misma clave en paralelo, o un segundo cobro aprobado: los índices únicos deciden.
      if (err.constraint === 'ux_pago_aprobado_por_cotizacion') throw yaAprobado();
      const { existente } = await this.prepararCobro(ctx, {
        cotizacionId: datos.cotizacionId,
        claveIdempotencia: datos.claveIdempotencia,
        huella: datos.huella,
      }).catch((e) => {
        if (e.code === 'MANI-PAG-409K') throw e;
        return {};
      });
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
