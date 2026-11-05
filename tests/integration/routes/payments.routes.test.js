const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const CreatePaymentUseCase = require('../../../src/application/useCases/payments/CreatePaymentUseCase');
const GetPaymentUseCase = require('../../../src/application/useCases/payments/GetPaymentUseCase');
const MockPaymentProvider = require('../../../src/infrastructure/payments/MockPaymentProvider');
const { NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COTIZACION = '33333333-3333-4333-8333-333333333333';
const PAGO = '55555555-5555-4555-8555-555555555555';

function bearer({ role = 'cliente' } = {}) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

const pagoAprobado = {
  id: PAGO, cotizacionId: COTIZACION, monto: 150000, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: 'mock-pay-x', creadoEn: '2026-10-26T20:00:00.000Z',
};

// Sustituye los casos de uso del container por unos con repositorio falso y los restaura al terminar.
function conPagos({ creado = true, obtener = async () => pagoAprobado } = {}, fn) {
  return async () => {
    const original = { c: container.createPaymentUseCase, g: container.getPaymentUseCase };
    const registrados = [];
    const paymentRepository = {
      prepararCobro: async () => ({ cobro: { cotizacionId: COTIZACION, solicitudId: 's', clienteId: 'c', monto: 150000, moneda: 'COP' } }),
      registrar: async (ctx, datos) => (registrados.push(datos), { pago: { ...pagoAprobado, estado: datos.estado, correlationId: datos.correlationId }, creado }),
      obtener,
    };
    container.createPaymentUseCase = new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider: new MockPaymentProvider({ idFactory: () => 'x' }),
      auditLogger: () => {},
    });
    container.getPaymentUseCase = new GetPaymentUseCase({ paymentRepository });
    try {
      await fn(registrados);
    } finally {
      container.createPaymentUseCase = original.c;
      container.getPaymentUseCase = original.g;
    }
  };
}

test('POST /pagos sin Authorization responde 401', async () => {
  assert.equal((await request(app).post('/api/v1/pagos').send({ cotizacionId: COTIZACION })).status, 401);
});

test('POST /pagos con un aliado responde 403 y no registra nada', conPagos({}, async (registrados) => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer({ role: 'aliado' })).send({ cotizacionId: COTIZACION });

  assert.equal(res.status, 403);
  assert.equal(registrados.length, 0);
}));

test('C1: POST /pagos aprobado responde 201 con el pago identificado como simulado', conPagos({}, async (registrados) => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).set('X-Correlation-ID', 'corr-ruta-1').send({ cotizacionId: COTIZACION });

  assert.equal(res.status, 201);
  assert.equal(res.body.pago.estado, 'APROBADO');
  assert.equal(res.body.pago.simulado, true);
  assert.equal(res.body.pago.proveedor, 'mock');
  assert.equal(registrados.length, 1);
  assert.ok(res.body.correlationId);
}));

test('POST /pagos con la misma clave de idempotencia responde 200 (no duplica)', conPagos({ creado: false }, async () => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).send({ cotizacionId: COTIZACION });
  assert.equal(res.status, 200);
}));

test('C2: un timeout del proveedor responde 504 con código, mensaje accionable y correlationId, sin registrar', conPagos({}, async (registrados) => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).set('X-Correlation-ID', 'corr-timeout').send({ cotizacionId: COTIZACION, escenario: 'TIMEOUT' });

  assert.equal(res.status, 504);
  assert.equal(res.body.code, 'MANI-PAG-504');
  assert.match(res.body.error, /No se realizó ningún cobro/);
  assert.ok(res.body.correlationId && res.body.correlationId !== 'none');
  assert.equal(registrados.length, 0);
}));

test('C2: una respuesta inválida del proveedor responde 502 y no registra', conPagos({}, async (registrados) => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).send({ cotizacionId: COTIZACION, escenario: 'RESPUESTA_INVALIDA' });

  assert.equal(res.status, 502);
  assert.equal(registrados.length, 0);
}));

test('POST /pagos con datos de tarjeta responde 400 y no registra', conPagos({}, async (registrados) => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).send({ cotizacionId: COTIZACION, numeroTarjeta: '4111111111111111' });

  assert.equal(res.status, 400);
  assert.equal(registrados.length, 0);
}));

test('GET /pagos/:id devuelve el pago del cliente y /comprobante el comprobante simulado', conPagos({}, async () => {
  const pago = await request(app).get(`/api/v1/pagos/${PAGO}`).set('Authorization', bearer());
  assert.equal(pago.status, 200);
  assert.equal(pago.body.pago.id, PAGO);

  const comprobante = await request(app).get(`/api/v1/pagos/${PAGO}/comprobante`).set('Authorization', bearer());
  assert.equal(comprobante.status, 200);
  assert.equal(comprobante.body.comprobante.simulado, true);
  assert.match(comprobante.body.comprobante.leyenda, /SANDBOX/);
}));

test('C3: el pago de otro cliente o tenant responde 404, igual que uno inexistente', conPagos(
  { obtener: async () => { throw new NotFoundError('MANI-PAG-404: pago o cotización no encontrados', 'MANI-PAG-404'); } },
  async () => {
    for (const ruta of [`/api/v1/pagos/${PAGO}`, `/api/v1/pagos/${PAGO}/comprobante`]) {
      const res = await request(app).get(ruta).set('Authorization', bearer());
      assert.equal(res.status, 404, ruta);
      assert.equal(res.body.code, 'MANI-PAG-404');
    }
  }
));

test('GET /pagos/:id con un id inválido responde 400', conPagos({}, async () => {
  assert.equal((await request(app).get('/api/v1/pagos/no-es-uuid').set('Authorization', bearer())).status, 400);
}));

test('sin DATABASE_URL los pagos responden 503 en lugar de inventar datos', async () => {
  const res = await request(app).post('/api/v1/pagos').set('Authorization', bearer()).send({ cotizacionId: COTIZACION });
  assert.equal(res.status, 503);
});
