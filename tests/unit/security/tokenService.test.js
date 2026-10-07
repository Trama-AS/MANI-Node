const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const TokenService = require('../../../src/infrastructure/security/TokenService');

const SECRET = 'test-secret-for-token-service-32chars!!';

function signToken(appMetadata, options = {}) {
  return jwt.sign({ sub: 'user-1', app_metadata: appMetadata }, SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    ...options,
  });
}

function tokenService(overrides = {}) {
  return new TokenService({ jwtSecret: SECRET, ...overrides });
}

test('token HS256 firmado con la clave correcta retorna { userId, tenantId, role }', async () => {
  const token = signToken({ tenant_id: 'trama-demo', user_role: 'aliado' });

  const session = await tokenService().verifyToken(`Bearer ${token}`);

  assert.deepEqual(session, { userId: 'user-1', tenantId: 'trama-demo', role: 'ALLY' });
});

test('token con firma alterada/falsificada lanza UnauthorizedError TOKEN_INVALID', async () => {
  const token = signToken({ tenant_id: 'trama-demo', user_role: 'aliado' });
  const tampered = token.slice(0, -2) + 'xx';

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${tampered}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('token con payload manipulado (tenant_id falsificado) falla criptográficamente', async () => {
  const token = signToken({ tenant_id: 'trama-demo', user_role: 'aliado' });
  const [header, , signature] = token.split('.');

  // Reemplaza el payload por uno con otro tenant_id, pero reutiliza la firma original:
  // sin la clave, es imposible generar una firma válida para el payload falsificado.
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'user-1', app_metadata: { tenant_id: 'otro-tenant', user_role: 'admin_tenant' } })
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const forgedToken = `${header}.${forgedPayload}.${signature}`;

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${forgedToken}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});

test('token expirado lanza UnauthorizedError TOKEN_EXPIRED', async () => {
  const token = signToken({ tenant_id: 'trama-demo', user_role: 'aliado' }, { expiresIn: -10 });

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_EXPIRED');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('token sin app_metadata.tenant_id lanza TOKEN_INVALID', async () => {
  const token = signToken({ user_role: 'aliado' });

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('token sin app_metadata.user_role lanza TOKEN_INVALID (no cae a payload.role)', async () => {
  // payload.role: 'authenticated' es lo que de verdad manda Supabase en la raíz
  // del JWT (claim genérico de GoTrue, no es un rol de negocio) — confiar en él
  // sería aceptar cualquier usuario autenticado como si tuviera rol válido.
  const token = jwt.sign(
    { sub: 'user-1', role: 'authenticated', app_metadata: { tenant_id: 'trama-demo' } },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});

test('ignora tenant_id/role en la raíz del payload: solo confía en app_metadata', async () => {
  const token = jwt.sign(
    { sub: 'user-1', tenant_id: 'otro-tenant-raiz', role: 'ADMIN', app_metadata: { tenant_id: 'trama-demo', user_role: 'cliente' } },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const session = await tokenService().verifyToken(`Bearer ${token}`);

  assert.equal(session.tenantId, 'trama-demo');
  assert.equal(session.role, 'CLIENT');
});

test('sin encabezado Authorization lanza UnauthorizedError UNAUTHORIZED', async () => {
  await assert.rejects(
    () => tokenService().verifyToken(undefined),
    (err) => {
      assert.equal(err.code, 'UNAUTHORIZED');
      return true;
    }
  );
});

test('token firmado con una clave distinta a la del servicio es rechazado', async () => {
  const tokenFirmadoConOtraClave = jwt.sign(
    { sub: 'user-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'admin_tenant' } },
    'otra-clave-completamente-distinta',
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${tokenFirmadoConOtraClave}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});

test('un algoritmo no soportado (ninguno de HS256/ES256) es rechazado', async () => {
  const tokenNoneAlg = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
    JSON.stringify({ sub: 'user-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'aliado' } })
  ).toString('base64url')}.`;

  await assert.rejects(
    () => tokenService().verifyToken(`Bearer ${tokenNoneAlg}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});

test('ES256: verifica usando la clave pública resuelta vía JWKS (doble inyectado)', async () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const token = jwt.sign(
    { sub: 'user-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'aliado' } },
    privateKey,
    { algorithm: 'ES256', expiresIn: '1h', keyid: 'test-kid-1' }
  );

  const fakeJwks = {
    getSigningKey: (kid, callback) => {
      assert.equal(kid, 'test-kid-1');
      callback(null, { getPublicKey: () => publicKey });
    },
  };

  const session = await tokenService({ jwks: fakeJwks, jwtSecret: undefined }).verifyToken(`Bearer ${token}`);

  assert.deepEqual(session, { userId: 'user-1', tenantId: 'trama-demo', role: 'ALLY' });
});

test('ES256 sin JWKS configurado es rechazado', async () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const token = jwt.sign(
    { sub: 'user-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'aliado' } },
    privateKey,
    { algorithm: 'ES256', expiresIn: '1h', keyid: 'test-kid-1' }
  );

  await assert.rejects(
    () => new TokenService({ jwtSecret: SECRET, jwks: null, supabaseUrl: undefined }).verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});
