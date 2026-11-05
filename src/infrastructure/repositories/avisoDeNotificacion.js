/**
 * Id de la fila de `notificacion` que una operación del ciclo del servicio acaba de insertar (`RETURNING id`), para que
 * el caso de uso la entregue por push DESPUÉS del commit (SCRUM-884). Si no hubo inserción (por ejemplo, un reintento
 * que no repite el aviso) no agrega nada al resultado.
 * @returns {{ notificacionId: string } | {}}
 */
function avisoDeNotificacion(resultado) {
  const id = resultado && resultado.rows && resultado.rows[0] && resultado.rows[0].id;
  return id ? { notificacionId: id } : {};
}

module.exports = { avisoDeNotificacion };
