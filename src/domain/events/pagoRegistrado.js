const crypto = require('node:crypto');

// Evento `PagoRegistrado` v1 (SCRUM-889). Lo produce Core cuando el proveedor de pagos resuelve un intento de pago y
// queda registrado en `pago`, sea cual sea el desenlace (APROBADO, RECHAZADO o PENDIENTE; `data.estado` lo dice).
// Sigue el sobre común de CONTRATOS_EVENTOS.md §3 y la frontera de datos de ADR-0030: solo identificadores, estado e
// importes. Nunca lleva datos de tarjeta ni de contacto de las personas.
const TIPO = 'PagoRegistrado';
const VERSION = 1;
const TOPICO = 'mani.pago.pago-registrado.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El sobre exige un `correlation_id` UUID; el de la petición puede no serlo (otros formatos del Gateway). */
function correlacionValida(correlationId) {
  return UUID_RE.test(String(correlationId || '')) ? String(correlationId) : crypto.randomUUID();
}

/**
 * @param {object} datos
 * @param {{ id: string, cotizacionId: string, estado: string, monto: number, moneda: string, proveedor: string,
 *   simulado: boolean }} datos.pago
 * @param {{ solicitudId: string, aliadoId: string, clienteId: string }} datos.agregados
 * @returns {object} fila lista para `outbox_evento`
 */
function construirPagoRegistrado({ pago, agregados, correlationId }) {
  return {
    id: crypto.randomUUID(),
    tipoEvento: TIPO,
    versionEvento: VERSION,
    topico: TOPICO,
    clavePart: agregados.solicitudId,
    idAgregado: pago.id,
    correlationId: correlacionValida(correlationId),
    payload: {
      id_pago: pago.id,
      id_solicitud: agregados.solicitudId,
      id_cotizacion: pago.cotizacionId,
      id_cliente: agregados.clienteId,
      id_aliado: agregados.aliadoId,
      estado: pago.estado,
      monto: pago.monto,
      moneda: pago.moneda,
      proveedor: pago.proveedor,
      simulado: pago.simulado,
    },
  };
}

/** Sobre común (`EventEnvelope v1`) que viaja a Kafka a partir de una fila del outbox. */
function sobreDe(fila) {
  return {
    event_id: fila.id,
    event_type: fila.tipo_evento,
    event_version: fila.version_evento,
    occurred_at: fila.fecha_ocurrencia instanceof Date ? fila.fecha_ocurrencia.toISOString() : fila.fecha_ocurrencia,
    tenant_id: fila.tenant_id,
    correlation_id: fila.correlation_id,
    partition_key: fila.clave_particion,
    data: fila.payload,
  };
}

module.exports = { construirPagoRegistrado, sobreDe, correlacionValida, TIPO, VERSION, TOPICO };
