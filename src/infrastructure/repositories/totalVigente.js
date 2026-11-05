/**
 * Total vigente del servicio (SCRUM-872, decisión de la PO del 27-oct): la cotización aceptada más las adiciones
 * aceptadas. Esta subconsulta suma las adiciones aceptadas de la cotización `cot` (el alias es obligatorio en la
 * consulta que la use). La comparten las adiciones y el monto del pago (SCRUM-1432), para que el pago no recalcule el
 * total por su cuenta.
 */
const ADICIONES_ACEPTADAS_SQL = `(SELECT coalesce(sum(ad.valor_mano_obra + ad.valor_materiales), 0)
   FROM adicion_servicio ad
   WHERE ad.cotizacion_id = cot.id AND ad.tenant_id = cot.tenant_id AND ad.estado = 'ACEPTADA')`;

module.exports = { ADICIONES_ACEPTADAS_SQL };
