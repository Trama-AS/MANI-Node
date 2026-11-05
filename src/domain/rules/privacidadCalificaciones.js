/**
 * Privacidad de las calificaciones entre participantes (M-08).
 *
 * La calificación que el cliente le da al aliado y la que el aliado le da al
 * cliente son privadas entre ellos: cada participante ve solo la que él emitió.
 * De la del otro sabe únicamente si ya existe, porque de eso depende el cierre
 * bidireccional (SCRUM-1418). El administrador del tenant ve ambas.
 *
 * Por la misma razón, el promedio de reputación del aliado no se devuelve al
 * aliado junto con el resumen del servicio: con una sola calificación revelaría
 * el puntaje que le dio el cliente.
 */

/** Clave de la calificación que el rol NO puede ver; null si puede verlas todas. */
function claveAjena(role) {
  if (role === 'CLIENT') return 'aliadoAlCliente';
  if (role === 'ALLY') return 'clienteAlAliado';
  return null;
}

/** Rol que ve todas las calificaciones del tenant. */
function veTodas(role) {
  return role === 'ADMIN';
}

/**
 * Oculta la calificación del otro participante en un bloque `calificaciones`
 * ({ clienteAlAliado, aliadoAlCliente, ... }). Deja `calificacionRecibidaRegistrada`
 * para que la app muestre que el otro ya calificó sin revelar el puntaje.
 */
function ocultarEnBloque(calificaciones, role) {
  if (!calificaciones || typeof calificaciones !== 'object' || veTodas(role)) return calificaciones;
  const ajena = claveAjena(role);
  if (!ajena) {
    // Rol desconocido: no ve ninguna (fallo cerrado).
    return { ...calificaciones, clienteAlAliado: null, aliadoAlCliente: null };
  }
  return {
    ...calificaciones,
    [ajena]: null,
    calificacionRecibidaRegistrada: calificaciones[ajena] !== null && calificaciones[ajena] !== undefined,
  };
}

/**
 * Aplica la privacidad a una respuesta del resumen de calificaciones y cierre
 * (GET/POST /solicitudes/:id/calificaciones y el cierre). La calificación que
 * acaba de registrar el propio autor (`calificacion`) siempre es suya.
 */
function aplicarPrivacidadResumen(resumen, role) {
  if (!resumen || typeof resumen !== 'object' || veTodas(role)) return resumen;
  const salida = { ...resumen };
  if ('calificaciones' in salida) salida.calificaciones = ocultarEnBloque(salida.calificaciones, role);
  if (role !== 'CLIENT' && 'reputacionAliado' in salida) salida.reputacionAliado = null;
  return salida;
}

/** Aplica la privacidad a cada elemento de un historial (cliente o aliado). */
function aplicarPrivacidadHistorial(items, role) {
  if (!Array.isArray(items) || veTodas(role)) return items;
  return items.map((item) =>
    item && item.calificaciones ? { ...item, calificaciones: ocultarEnBloque(item.calificaciones, role) } : item
  );
}

module.exports = {
  aplicarPrivacidadResumen,
  aplicarPrivacidadHistorial,
  ocultarEnBloque,
};
