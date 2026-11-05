const test = require('node:test');
const assert = require('node:assert/strict');
const IPaymentProvider = require('../../../src/domain/ports/IPaymentProvider');
const IPushProvider = require('../../../src/domain/ports/IPushProvider');

// SCRUM-1240 (ARQ-09): pruebas de contrato que todo adaptador de proveedor debe pasar, sea el mock de hoy o el
// proveedor real que lo reemplace. Un adaptador nuevo se agrega en providers.contract.test.js con una línea.
// No dependen de escenarios propios del mock: solo de lo que promete el puerto.

const TENANT = '11111111-1111-4111-8111-111111111111';
const DESENLACES = ['APROBADO', 'RECHAZADO', 'PENDIENTE'];

function cobro(extra = {}) {
  return { monto: 150000, moneda: 'COP', referencia: 'cot-1', correlationId: 'corr-contrato', ...extra };
}

function contratoDeProveedorDePagos(nombre, crear) {
  test(`[contrato pagos] ${nombre}: implementa el puerto y se identifica`, () => {
    const proveedor = crear();
    assert.ok(proveedor instanceof IPaymentProvider);
    assert.equal(typeof proveedor.name, 'string');
    assert.notEqual(proveedor.name.trim(), '');
    assert.equal(typeof proveedor.simulated, 'boolean');
  });

  test(`[contrato pagos] ${nombre}: un cobro devuelve un desenlace del contrato con referencia del proveedor`, async () => {
    const resultado = await crear().charge(cobro({ idempotencyKey: 'clave-1', signal: new AbortController().signal }));
    assert.ok(DESENLACES.includes(resultado.estado), `estado fuera de contrato: ${resultado.estado}`);
    assert.equal(typeof resultado.referencia, 'string');
    assert.notEqual(resultado.referencia.trim(), '');
  });

  test(`[contrato pagos] ${nombre}: la misma clave de idempotencia no cobra dos veces`, async () => {
    const proveedor = crear();
    const primero = await proveedor.charge(cobro({ idempotencyKey: 'clave-unica' }));
    const repetido = await proveedor.charge(cobro({ idempotencyKey: 'clave-unica' }));
    assert.deepEqual(repetido, primero);
  });

  test(`[contrato pagos] ${nombre}: claves distintas son cobros distintos`, async () => {
    const proveedor = crear();
    const a = await proveedor.charge(cobro({ idempotencyKey: 'clave-a' }));
    const b = await proveedor.charge(cobro({ idempotencyKey: 'clave-b' }));
    assert.notEqual(a.referencia, b.referencia);
  });
}

function notificacion(extra = {}) {
  return {
    notificacionId: 'n-1',
    tenantId: TENANT,
    usuarioId: 'u-1',
    tipo: 'OFERTA_DESPACHO',
    payload: { requestId: 'r-1' },
    correlationId: 'corr-contrato',
    ...extra,
  };
}

function contratoDeProveedorPush(nombre, crear) {
  test(`[contrato push] ${nombre}: implementa el puerto y se identifica`, () => {
    const proveedor = crear();
    assert.ok(proveedor instanceof IPushProvider);
    assert.equal(typeof proveedor.name, 'string');
    assert.notEqual(proveedor.name.trim(), '');
    assert.equal(typeof proveedor.simulated, 'boolean');
  });

  test(`[contrato push] ${nombre}: la entrega dice qué proveedor la hizo y si fue simulada`, async () => {
    const proveedor = crear();
    const entrega = await proveedor.send(notificacion({ idempotencyKey: 'n-1', signal: new AbortController().signal }));
    assert.equal(entrega.proveedor, proveedor.name);
    assert.ok(['ENTREGADA', 'SIMULADA'].includes(entrega.estado));
    assert.equal(entrega.simulada, proveedor.simulated);
    assert.equal(entrega.estado === 'SIMULADA', proveedor.simulated, 'una entrega simulada nunca se presenta como real');
    assert.equal(typeof entrega.mensajeId, 'string');
  });

  test(`[contrato push] ${nombre}: la misma clave de idempotencia no entrega dos veces`, async () => {
    const proveedor = crear();
    const primero = await proveedor.send(notificacion({ idempotencyKey: 'n-1' }));
    const repetido = await proveedor.send(notificacion({ idempotencyKey: 'n-1' }));
    assert.equal(repetido.mensajeId, primero.mensajeId);
  });

  test(`[contrato push] ${nombre}: notificaciones distintas son entregas distintas`, async () => {
    const proveedor = crear();
    const a = await proveedor.send(notificacion({ notificacionId: 'n-a', idempotencyKey: 'n-a' }));
    const b = await proveedor.send(notificacion({ notificacionId: 'n-b', idempotencyKey: 'n-b' }));
    assert.notEqual(a.mensajeId, b.mensajeId);
  });
}

module.exports = { contratoDeProveedorDePagos, contratoDeProveedorPush };
