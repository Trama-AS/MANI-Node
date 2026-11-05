/**
 * Escribe el evento inmutable de una transacción (SCRUM-889, HU-M11-03). Se llama con el cliente `pg` de la MISMA
 * transacción que registra el pago: si el pago no se guarda, tampoco queda el evento, y viceversa. Actor y rol son los
 * del JWT; la hora la pone la base; `ON CONFLICT DO NOTHING` hace que repetir la llamada no duplique el evento.
 * @returns {Promise<boolean>} `true` si se escribió un evento nuevo
 */
async function registrarEventoTransaccion(client, ctx, datos) {
  const { rowCount } = await client.query(
    `INSERT INTO transaccion_evento (tenant_id, pago_id, tipo, estado, monto, moneda, actor_id, actor_rol, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (pago_id, tipo) DO NOTHING`,
    [
      ctx.tenantId,
      datos.pagoId,
      datos.tipo,
      datos.estado,
      datos.monto,
      datos.moneda,
      ctx.userId,
      ctx.role,
      datos.correlationId || null,
    ]
  );
  return rowCount === 1;
}

module.exports = { registrarEventoTransaccion };
