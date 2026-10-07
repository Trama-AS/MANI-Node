const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const InMemoryAuthIdentityService = require('../../../src/infrastructure/security/InMemoryAuthIdentityService');

const SECRET = 'test-secret-for-identity-service-32chars!!';

test('createUser + authenticate emiten tokens con claims bajo app_metadata (forma real de Supabase)', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  const { userId } = await service.createUser({
    tenantId: 'trama-demo',
    email: 'a@mani.test',
    password: 'Cambiar123!',
    role: 'ALLY',
  });
  assert.ok(userId);

  const tokens = await service.authenticate({ tenantId: 'trama-demo', email: 'a@mani.test', password: 'Cambiar123!' });
  assert.equal(tokens.expiresIn, 3600);

  const claims = jwt.verify(tokens.accessToken, SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.sub, userId);
  assert.equal(claims.app_metadata.tenant_id, 'trama-demo');
  assert.equal(claims.app_metadata.user_role, 'aliado');

  const refreshClaims = jwt.verify(tokens.refreshToken, SECRET, { algorithms: ['HS256'] });
  assert.equal(refreshClaims.type, 'refresh');
});

test('authenticate lanza UnauthorizedError INVALID_CREDENTIALS con password incorrecto', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });
  await service.createUser({ tenantId: 't1', email: 'b@mani.test', password: 'CorrectPass1', role: 'ALLY' });

  await assert.rejects(
    () => service.authenticate({ tenantId: 't1', email: 'b@mani.test', password: 'wrong' }),
    (err) => {
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('authenticate lanza UnauthorizedError si el usuario no existe', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  await assert.rejects(
    () => service.authenticate({ tenantId: 't1', email: 'nadie@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      return true;
    }
  );
});

test('createUser nunca almacena la contraseña en texto plano', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  await service.createUser({ tenantId: 'trama-demo', email: 'c@mani.test', password: 'ContraseñaSecreta123', role: 'ALLY' });

  const stored = service.identities.get('trama-demo::c@mani.test');
  assert.ok(stored.passwordHash);
  assert.notEqual(stored.passwordHash, 'ContraseñaSecreta123');
});

test('cada createUser genera un userId distinto', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  const first = await service.createUser({ tenantId: 't1', email: 'x@mani.test', password: 'pw1234567', role: 'ALLY' });
  const second = await service.createUser({ tenantId: 't1', email: 'y@mani.test', password: 'pw1234567', role: 'ALLY' });

  assert.notEqual(first.userId, second.userId);
});
