/**
 * Escribe un evento en el outbox con el cliente `pg` de la MISMA transacción del cambio de negocio (ADR-0029): si la
 * transacción se revierte, el evento tampoco queda. `ON CONFLICT DO NOTHING` hace que repetir la llamada no duplique
 * el evento del mismo agregado y tipo.
 * @returns {Promise<boolean>} `true` si se escribió un evento nuevo
 */
async function escribirEnOutbox(client, ctx, evento) {
  const { rowCount } = await client.query(
    `INSERT INTO outbox_evento (id, tenant_id, tipo_evento, version_evento, topico, clave_particion, id_agregado,
                                correlation_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (id_agregado, tipo_evento) DO NOTHING`,
    [
      evento.id,
      ctx.tenantId,
      evento.tipoEvento,
      evento.versionEvento,
      evento.topico,
      evento.clavePart,
      evento.idAgregado,
      evento.correlationId,
      JSON.stringify(evento.payload),
    ]
  );
  return rowCount === 1;
}

module.exports = { escribirEnOutbox };
