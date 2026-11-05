const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { resolveJwtSecret, INSECURE_DEV_SECRET } = require('../../../src/config/jwtSecret');

// `/auth/validate-token` (lo que consulta el Gateway con auth_request) resuelve
// el secreto con config/jwtSecret.js, y el middleware `authenticate` de Core
// con config/index.js. Si los respaldos de desarrollo no coinciden, el Gateway
// acepta el token y Core lo rechaza después: en local, toda ruta autenticada
// responde 401 aunque el token sea el que el propio servicio emitió.
function configDeDesarrollo() {
  const previos = { NODE_ENV: process.env.NODE_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET };
  process.env.NODE_ENV = 'development';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;
  delete require.cache[require.resolve('../../../src/config')];
  try {
    return require('../../../src/config');
  } finally {
    for (const [k, v] of Object.entries(previos)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve('../../../src/config')];
  }
}

test('en desarrollo, Core y la verificación del Gateway resuelven el mismo secreto', () => {
  const config = configDeDesarrollo();

  assert.equal(config.supabaseJwtSecret, resolveJwtSecret({ NODE_ENV: 'development' }));
  assert.equal(config.supabaseJwtSecret, INSECURE_DEV_SECRET);
});

test('un token firmado con el secreto del Gateway lo verifica también Core', () => {
  const config = configDeDesarrollo();
  const token = jwt.sign(
    { sub: 'user-1', app_metadata: { tenant_id: 'tenant-a', user_role: 'admin_tenant' } },
    resolveJwtSecret({ NODE_ENV: 'development' }),
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const verificado = jwt.verify(token, config.supabaseJwtSecret, { algorithms: ['HS256'] });

  assert.equal(verificado.app_metadata.tenant_id, 'tenant-a');
});

test('con SUPABASE_JWT_SECRET en el entorno ambos usan ese valor y no el respaldo', () => {
  const previos = { NODE_ENV: process.env.NODE_ENV, SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET };
  process.env.NODE_ENV = 'development';
  process.env.SUPABASE_JWT_SECRET = 'secreto-del-entorno-para-la-prueba';
  delete require.cache[require.resolve('../../../src/config')];
  try {
    const config = require('../../../src/config');
    assert.equal(config.supabaseJwtSecret, 'secreto-del-entorno-para-la-prueba');
    assert.equal(resolveJwtSecret(process.env), 'secreto-del-entorno-para-la-prueba');
  } finally {
    for (const [k, v] of Object.entries(previos)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve('../../../src/config')];
  }
});
