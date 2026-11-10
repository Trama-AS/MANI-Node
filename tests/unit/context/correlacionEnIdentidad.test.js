const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutarComo, identidadActual } = require('../../../src/application/context/contextoIdentidad');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const TENANT = '10000000-0000-4000-8000-000000000011';
const USER = '30000000-0000-4000-8000-000000000012';

function poolFalso() {
  const consultas = [];
  const client = { query: async (sql, params) => (consultas.push({ sql, params }), { rows: [] }), release() {} };
  return { consultas, factory: { getPool: () => ({ connect: async () => client }) } };
}

test('SCRUM-1657: la identidad de la petición lleva el correlation ID y queda congelada', () => {
  ejecutarComo({ tenantId: TENANT, userId: USER, role: 'CLIENT', correlationId: 'corr-1' }, () => {
    assert.equal(identidadActual().correlationId, 'corr-1');
    assert.throws(() => { 'use strict'; identidadActual().correlationId = 'otro'; }, TypeError);
  });
  ejecutarComo({ tenantId: TENANT }, () => assert.equal(identidadActual().correlationId, null));
});

test('SCRUM-1657: runInTenantContext toma el correlation ID de la petición en curso si el llamador no lo trae', async () => {
  const { consultas, factory } = poolFalso();
  await ejecutarComo({ tenantId: TENANT, userId: USER, role: 'CLIENT', correlationId: 'corr-ambiente' }, () =>
    runInTenantContext(factory, { tenantId: TENANT, userId: USER, role: 'CLIENT' }, async () => 'ok')
  );
  const fijado = consultas.find((c) => c.sql.includes('app.correlation_id'));
  assert.deepEqual(fijado.params, ['corr-ambiente']);
});

test('SCRUM-1657: el correlation ID explícito del llamador manda sobre el de la petición', async () => {
  const { consultas, factory } = poolFalso();
  await ejecutarComo({ tenantId: TENANT, userId: USER, role: 'CLIENT', correlationId: 'corr-ambiente' }, () =>
    runInTenantContext(factory, { tenantId: TENANT, userId: USER, role: 'CLIENT', correlationId: 'corr-propio' }, async () => 'ok')
  );
  assert.deepEqual(consultas.find((c) => c.sql.includes('app.correlation_id')).params, ['corr-propio']);
});
