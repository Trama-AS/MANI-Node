const test = require('node:test');
const assert = require('node:assert/strict');
const RatingsAndClosureUseCase = require('../../../../src/application/useCases/ratings/RatingsAndClosureUseCase');
const {
  aplicarPrivacidadResumen,
  aplicarPrivacidadHistorial,
  ocultarEnBloque,
} = require('../../../../src/domain/rules/privacidadCalificaciones');

const TENANT = '11111111-1111-4111-8111-111111111111';
const SOLICITUD_ID = '66666666-6666-4666-8666-666666666666';
const sesion = (role, userId) => ({ tenantId: TENANT, userId, role });
const cliente = sesion('CLIENT', '33333333-3333-4333-8333-333333333333');
const aliado = sesion('ALLY', '44444444-4444-4444-8444-444444444444');
const admin = sesion('ADMIN', '55555555-5555-4555-8555-555555555555');

const DEL_CLIENTE = { id: 'cal-c', direccion: 'CLIENTE_A_ALIADO', puntaje: 1, comentario: 'que basura de servicio' };
const DEL_ALIADO = { id: 'cal-a', direccion: 'ALIADO_A_CLIENTE', puntaje: 5, comentario: 'muy amable' };

function resumenCompleto() {
  return {
    calificaciones: { clienteAlAliado: { ...DEL_CLIENTE }, aliadoAlCliente: { ...DEL_ALIADO } },
    cierre: {
      solicitudId: SOLICITUD_ID,
      estadoSolicitud: 'CERRADA',
      calificacionClienteRegistrada: true,
      calificacionAliadoRegistrada: true,
      cierreCompleto: true,
    },
    reputacionAliado: { promedio: 1, total: 1 },
  };
}

test('privacidad: el cliente ve su calificación y no la que le dio el aliado', () => {
  const r = aplicarPrivacidadResumen(resumenCompleto(), 'CLIENT');
  assert.deepEqual(r.calificaciones.clienteAlAliado, DEL_CLIENTE);
  assert.equal(r.calificaciones.aliadoAlCliente, null);
  assert.equal(r.calificaciones.calificacionRecibidaRegistrada, true);
  // El cierre sigue informando que ambas existen: de eso depende el cierre bidireccional.
  assert.equal(r.cierre.calificacionAliadoRegistrada, true);
  assert.equal(r.cierre.cierreCompleto, true);
  // La reputación del aliado la sigue viendo el cliente (es la que él usa para elegir).
  assert.deepEqual(r.reputacionAliado, { promedio: 1, total: 1 });
  assert.ok(!JSON.stringify(r).includes('muy amable'));
});

test('privacidad: el aliado ve su calificación, no la del cliente ni su promedio en el resumen', () => {
  const r = aplicarPrivacidadResumen(resumenCompleto(), 'ALLY');
  assert.deepEqual(r.calificaciones.aliadoAlCliente, DEL_ALIADO);
  assert.equal(r.calificaciones.clienteAlAliado, null);
  assert.equal(r.calificaciones.calificacionRecibidaRegistrada, true);
  // Con una sola calificación el promedio revelaría el puntaje del cliente.
  assert.equal(r.reputacionAliado, null);
  assert.ok(!JSON.stringify(r).includes('que basura de servicio'));
});

test('privacidad: el administrador del tenant ve ambas calificaciones sin cambios', () => {
  const original = resumenCompleto();
  assert.deepEqual(aplicarPrivacidadResumen(original, 'ADMIN'), original);
});

test('privacidad: sin calificación del otro, calificacionRecibidaRegistrada es false', () => {
  const bloque = ocultarEnBloque({ clienteAlAliado: { ...DEL_CLIENTE }, aliadoAlCliente: null }, 'CLIENT');
  assert.equal(bloque.calificacionRecibidaRegistrada, false);
  assert.deepEqual(bloque.clienteAlAliado, DEL_CLIENTE);
});

test('privacidad: un rol desconocido no ve ninguna calificación (fallo cerrado)', () => {
  const bloque = ocultarEnBloque({ clienteAlAliado: DEL_CLIENTE, aliadoAlCliente: DEL_ALIADO }, 'OTRO');
  assert.equal(bloque.clienteAlAliado, null);
  assert.equal(bloque.aliadoAlCliente, null);
});

test('privacidad: el historial oculta la calificación recibida en cada servicio', () => {
  const items = [
    { id: 's1', calificaciones: { clienteAlAliado: { puntaje: 2 }, aliadoAlCliente: { puntaje: 4 }, cierreCompleto: true } },
    { id: 's2', calificaciones: { clienteAlAliado: null, aliadoAlCliente: null, cierreCompleto: false } },
  ];
  const delCliente = aplicarPrivacidadHistorial(items, 'CLIENT');
  assert.deepEqual(delCliente[0].calificaciones.clienteAlAliado, { puntaje: 2 });
  assert.equal(delCliente[0].calificaciones.aliadoAlCliente, null);
  assert.equal(delCliente[0].calificaciones.calificacionRecibidaRegistrada, true);
  assert.equal(delCliente[0].calificaciones.cierreCompleto, true);
  assert.equal(delCliente[1].calificaciones.calificacionRecibidaRegistrada, false);

  const delAliado = aplicarPrivacidadHistorial(items, 'ALLY');
  assert.equal(delAliado[0].calificaciones.clienteAlAliado, null);
  assert.deepEqual(delAliado[0].calificaciones.aliadoAlCliente, { puntaje: 4 });
  // No muta la entrada.
  assert.deepEqual(items[0].calificaciones.aliadoAlCliente, { puntaje: 4 });
});

test('privacidad: el caso de uso la aplica en consulta, calificación, cierre e historiales', async () => {
  const repo = {
    consultarCalificacionesYCierre: async () => resumenCompleto(),
    cerrarSolicitud: async () => resumenCompleto(),
    registrarCalificacion: async () => ({ calificacion: { ...DEL_ALIADO }, ...resumenCompleto() }),
    listarHistorialCliente: async () => [{ id: 's1', calificaciones: resumenCompleto().calificaciones }],
    listarHistorialAliado: async () => [{ id: 's1', calificaciones: resumenCompleto().calificaciones }],
    obtenerTrabajoAliado: async () => ({ id: 's1', calificaciones: resumenCompleto().calificaciones }),
  };
  const uc = new RatingsAndClosureUseCase({ ratingsRepository: repo });

  const consultaCliente = await uc.consultarCalificacionesYCierre({ user: cliente, solicitudId: SOLICITUD_ID });
  assert.equal(consultaCliente.calificaciones.aliadoAlCliente, null);

  const consultaAdmin = await uc.consultarCalificacionesYCierre({ user: admin, solicitudId: SOLICITUD_ID });
  assert.deepEqual(consultaAdmin.calificaciones.aliadoAlCliente, DEL_ALIADO);
  assert.deepEqual(consultaAdmin.calificaciones.clienteAlAliado, DEL_CLIENTE);

  const cierreAliado = await uc.cerrarSolicitud({ user: aliado, solicitudId: SOLICITUD_ID });
  assert.equal(cierreAliado.calificaciones.clienteAlAliado, null);

  const calificaAliado = await uc.calificar({ user: aliado, solicitudId: SOLICITUD_ID, body: { puntaje: 5 } });
  assert.deepEqual(calificaAliado.calificacion, DEL_ALIADO);
  assert.equal(calificaAliado.calificaciones.clienteAlAliado, null);
  assert.equal(calificaAliado.reputacionAliado, null);

  const histCliente = await uc.listarHistorialCliente({ user: cliente });
  assert.equal(histCliente.historial[0].calificaciones.aliadoAlCliente, null);

  const histAliado = await uc.listarHistorialAliado({ user: aliado });
  assert.equal(histAliado.trabajos[0].calificaciones.clienteAlAliado, null);

  const trabajo = await uc.obtenerTrabajoAliado({ user: aliado, solicitudId: SOLICITUD_ID });
  assert.equal(trabajo.calificaciones.clienteAlAliado, null);
});
