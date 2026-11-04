const test = require('node:test');
const assert = require('node:assert/strict');
const { construirPagoRegistrado, sobreDe, correlacionValida, TIPO, VERSION, TOPICO } = require('../../../src/domain/events/pagoRegistrado');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGO = {
  id: '11111111-1111-4111-8111-111111111111',
  cotizacionId: '22222222-2222-4222-8222-222222222222',
  estado: 'APROBADO',
  monto: 150000.5,
  moneda: 'COP',
  proveedor: 'mock',
  simulado: true,
  referenciaProveedor: 'mock-pay-secreta',
  motivo: 'texto libre',
};
const AGREGADOS = { solicitudId: '33333333-3333-4333-8333-333333333333', aliadoId: '44444444-4444-4444-8444-444444444444', clienteId: '55555555-5555-4555-8555-555555555555' };

test('PagoRegistrado v1: tipo, versión, tópico, agregado y clave de partición (la solicitud)', () => {
  const e = construirPagoRegistrado({ pago: PAGO, agregados: AGREGADOS, correlationId: '66666666-6666-4666-8666-666666666666' });
  assert.deepEqual([e.tipoEvento, e.versionEvento, e.topico], ['PagoRegistrado', 1, 'mani.pago.pago-registrado.v1']);
  assert.deepEqual([TIPO, VERSION, TOPICO], [e.tipoEvento, e.versionEvento, e.topico]);
  assert.equal(e.idAgregado, PAGO.id);
  assert.equal(e.clavePart, AGREGADOS.solicitudId, 'todos los eventos de una solicitud van a la misma partición');
  assert.match(e.id, UUID_RE);
  assert.equal(e.correlationId, '66666666-6666-4666-8666-666666666666');
});

test('frontera de datos: solo identificadores, estado e importes; nada de la referencia del proveedor ni texto libre', () => {
  const { payload } = construirPagoRegistrado({ pago: PAGO, agregados: AGREGADOS });
  assert.deepEqual(Object.keys(payload).sort(), [
    'estado', 'id_aliado', 'id_cliente', 'id_cotizacion', 'id_pago', 'id_solicitud', 'moneda', 'monto', 'proveedor', 'simulado',
  ]);
  const texto = JSON.stringify(payload);
  assert.ok(!texto.includes('mock-pay-secreta') && !texto.includes('texto libre'));
  assert.equal(payload.simulado, true);
  assert.equal(payload.monto, 150000.5);
});

test('un correlation_id que no es UUID se reemplaza por uno válido: el sobre lo exige', () => {
  for (const malo of [undefined, null, '', 'node-1791318617328', 'no-uuid']) {
    assert.match(correlacionValida(malo), UUID_RE);
  }
  assert.equal(correlacionValida('66666666-6666-4666-8666-666666666666'), '66666666-6666-4666-8666-666666666666');
});

test('el sobre común trae los ocho campos del contrato a partir de la fila del outbox', () => {
  const fecha = new Date('2026-11-04T01:00:00.000Z');
  const s = sobreDe({
    id: 'e1', tipo_evento: 'PagoRegistrado', version_evento: 1, fecha_ocurrencia: fecha, tenant_id: 't1', correlation_id: 'c1',
    clave_particion: 'p1', payload: { a: 1 },
  });
  assert.deepEqual(s, {
    event_id: 'e1', event_type: 'PagoRegistrado', event_version: 1, occurred_at: '2026-11-04T01:00:00.000Z', tenant_id: 't1',
    correlation_id: 'c1', partition_key: 'p1', data: { a: 1 },
  });
  assert.equal(sobreDe({ fecha_ocurrencia: 'ya-texto' }).occurred_at, 'ya-texto');
});
