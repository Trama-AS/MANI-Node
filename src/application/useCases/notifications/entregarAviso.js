/**
 * Entrega por push el aviso que una operación del ciclo del servicio dejó en la bandeja (SCRUM-884, C2). Se llama
 * DESPUÉS de que la operación se confirmó: el notificador no lanza, así que un fallo del push nunca la revierte.
 * Sin notificador (pruebas, o ambientes sin push) o sin aviso nuevo no hace nada.
 */
async function entregarAviso(notificador, ctx, notificacionId, correlationId) {
  if (!notificador || !notificacionId) return;
  await notificador.entregar(ctx, { notificacionId, correlationId });
}

module.exports = { entregarAviso };
