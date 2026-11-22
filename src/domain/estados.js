/**
 * Catálogo de estados de `solicitud` y `cotizacion` (SCRUM-1713, QAS-10).
 *
 * Es la misma lista que la migración 0043 impone como CHECK en la base (`ck_solicitud_estado`,
 * `ck_cotizacion_estado`). Cualquier estado nuevo hay que agregarlo aquí y en una migración nueva que reemplace el
 * CHECK; tests/unit/db/estadosCheck.test.js falla si las dos listas se desalinean.
 */
const ESTADOS_SOLICITUD = Object.freeze([
  'PENDIENTE',
  'ASIGNADA',
  'COTIZANDO',
  'ACEPTADA',
  'RECHAZADA',
  'EN_EJECUCION',
  'FINALIZADA',
  'CERRADA',
  'CANCELADA',
]);

const ESTADOS_COTIZACION = Object.freeze(['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'AJUSTE_SOLICITADO']);

module.exports = { ESTADOS_SOLICITUD, ESTADOS_COTIZACION };
