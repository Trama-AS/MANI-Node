// SCRUM-1468 (TEC-21): identidad ambiente para app.set_context y verificación del rol de la conexión.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { ejecutarComo, identidadActual } = require('../../../src/application/context/contextoIdentidad');
const { verificarRolServicio } = require('../../../src/infrastructure/db/verificarRolServicio');
const container = require('../../../src/container');
const { authenticate, identificarSiHayToken } = require('../../../src/middlewares/auth.middleware');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

test('ejecutarComo fija la identidad solo dentro del trabajo y la congela', async () => {
  assert.equal(identidadActual(), null);
  await ejecutarComo({ tenantId: T1, userId: 'u1', role: 'ALLY' }, async () => {
    await new Promise((r) => setImmediate(r));
    const actual = identidadActual();
    assert.deepEqual(actual, { tenantId: T1, userId: 'u1', role: 'ALLY', correlationId: null });
    assert.throws(() => {
      'use strict';
      actual.tenantId = T2;
    }, TypeError);
  });
  assert.equal(identidadActual(), null);
});

test('dos operaciones concurrentes no comparten identidad', async () => {
  const vistas = await Promise.all(
    [T1, T2].map((tenantId) =>
      ejecutarComo({ tenantId }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return identidadActual().tenantId;
      })
    )
  );
  assert.deepEqual(vistas, [T1, T2]);
});

test('ejecutarComo exige un tenant', () => {
  assert.throws(() => ejecutarComo({ userId: 'u' }, () => {}), /tenantId/);
  assert.throws(() => ejecutarComo(null, () => {}), /tenantId/);
});

function fabricaCon(fila) {
  return { isConfigured: () => true, getPool: () => ({ query: async () => ({ rows: [fila] }) }) };
}
const silencioso = { log() {}, warn() {} };

test('verificarRolServicio: en QA/producción un rol que salta RLS impide arrancar', async () => {
  await assert.rejects(
    verificarRolServicio(fabricaCon({ rol: 'postgres', salta_rls: true }), { exigir: true, logger: silencioso }),
    /postgres.*BYPASSRLS.*mani_core_svc/s
  );
});

test('verificarRolServicio: en desarrollo solo avisa, y con mani_core_svc no dice nada malo', async () => {
  const avisos = [];
  const logger = { log() {}, warn: (m) => avisos.push(m) };
  assert.deepEqual(await verificarRolServicio(fabricaCon({ rol: 'postgres', salta_rls: true }), { exigir: false, logger }), {
    rol: 'postgres',
    saltaRls: true,
  });
  assert.equal(avisos.length, 1);
  assert.deepEqual(
    await verificarRolServicio(fabricaCon({ rol: 'mani_core_svc', salta_rls: false }), { exigir: true, logger: silencioso }),
    { rol: 'mani_core_svc', saltaRls: false }
  );
  assert.equal(await verificarRolServicio({ isConfigured: () => false }, { exigir: true }), null, 'sin DATABASE_URL no verifica');
});

function conTokenService(t, verifyToken) {
  const original = container.tokenService.verifyToken;
  container.tokenService.verifyToken = verifyToken;
  t.after(() => {
    container.tokenService.verifyToken = original;
  });
}

test('authenticate e identificarSiHayToken dejan la identidad del JWT para el resto de la petición', async (t) => {
  conTokenService(t, async () => ({ userId: 'u-9', tenantId: T1, role: 'admin_tenant' }));
  for (const middleware of [authenticate, identificarSiHayToken]) {
    const req = { headers: { authorization: 'Bearer x' }, correlationId: 'corr-mw' };
    let vista;
    await middleware(req, {}, () => {
      vista = identidadActual();
    });
    // SCRUM-1657: el correlation ID de la petición acompaña a la identidad.
    assert.deepEqual(vista, { tenantId: T1, userId: 'u-9', role: 'admin_tenant', correlationId: 'corr-mw' });
    assert.equal(req.user.userId, 'u-9');
  }
});

test('identificarSiHayToken sigue sin identidad si falta el token o no es válido: el controlador responde su 401', async (t) => {
  conTokenService(t, async () => {
    throw Object.assign(new Error('token inválido'), { statusCode: 401 });
  });
  for (const headers of [{}, { authorization: 'Bearer malo' }]) {
    const req = { headers };
    let llamado = false;
    await identificarSiHayToken(req, {}, () => {
      llamado = true;
      assert.equal(identidadActual(), null);
    });
    assert.equal(llamado, true);
    assert.equal(req.user, undefined);
  }
});

test('un error de la ruta después de authenticate no se responde como 401', async (t) => {
  conTokenService(t, async () => ({ userId: 'u', tenantId: T1, role: 'cliente' }));
  const res = {
    status() {
      throw new Error('authenticate no debe responder');
    },
  };
  await assert.rejects(
    authenticate({ headers: { authorization: 'Bearer x' } }, res, () => {
      throw new Error('falla de la ruta');
    }),
    /falla de la ruta/
  );
});
