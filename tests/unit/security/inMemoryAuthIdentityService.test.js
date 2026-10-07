const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const InMemoryAuthIdentityService = require('../../../src/infrastructure/security/InMemoryAuthIdentityService');

const SECRET = 'test-secret-for-identity-service-32chars!!';

test('createIdentity emite accessToken/refreshToken firmados y verificables con el mismo secreto', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  const identity = await service.createIdentity({
    tenantId: 'trama-demo',
    email: 'a@mani.test',
    password: 'Cambiar123!',
    role: 'ALLY',
  });

  assert.ok(identity.userId);
  assert.equal(identity.expiresIn, 3600);

  const accessClaims = jwt.verify(identity.accessToken, SECRET, { algorithms: ['HS256'] });
  assert.equal(accessClaims.sub, identity.userId);
  assert.equal(accessClaims.tenant_id, 'trama-demo');
  assert.equal(accessClaims.role, 'ALLY');

  const refreshClaims = jwt.verify(identity.refreshToken, SECRET, { algorithms: ['HS256'] });
  assert.equal(refreshClaims.sub, identity.userId);
  assert.equal(refreshClaims.type, 'refresh');
});

test('createIdentity nunca almacena la contraseña en texto plano', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  await service.createIdentity({
    tenantId: 'trama-demo',
    email: 'b@mani.test',
    password: 'ContraseñaSecreta123',
    role: 'ALLY',
  });

  const stored = service.identities.get('trama-demo::b@mani.test');
  assert.ok(stored.passwordHash);
  assert.notEqual(stored.passwordHash, 'ContraseñaSecreta123');
});

test('cada llamada genera un userId distinto', async () => {
  const service = new InMemoryAuthIdentityService({ jwtSecret: SECRET });

  const first = await service.createIdentity({ tenantId: 't1', email: 'x@mani.test', password: 'pw1234567', role: 'ALLY' });
  const second = await service.createIdentity({ tenantId: 't1', email: 'y@mani.test', password: 'pw1234567', role: 'ALLY' });

  assert.notEqual(first.userId, second.userId);
});
