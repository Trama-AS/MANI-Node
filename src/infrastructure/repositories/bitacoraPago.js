/**
 * Deja constancia del pago aprobado en la bitácora de la solicitud (`evento_servicio`, la que ven el cliente dueño y
 * el aliado asignado en la pantalla del servicio). Se llama con el cliente `pg` de la MISMA transacción del pago: si el
 * pago no se guarda, el evento tampoco. Es la observación de QA sobre SCRUM-1432: el pago funcionaba pero no aparecía.
 *
 * Solo el pago APROBADO entra: un intento rechazado o pendiente no es un hito del servicio, y el aliado no tiene por
 * qué ver los intentos fallidos del cliente. La descripción no lleva monto ni referencia del proveedor; el detalle
 * está en el pago y en el registro de transacciones (SCRUM-889), con sus propias reglas de acceso.
 * @returns {Promise<void>}
 */
async function registrarPagoEnBitacora(client, ctx, solicitudId) {
  await client.query(
    `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
     VALUES ($1, $2, $3, 'PAGO_REGISTRADO', 'Pago aprobado (simulado)')`,
    [ctx.tenantId, solicitudId, ctx.userId]
  );
}

module.exports = { registrarPagoEnBitacora };
