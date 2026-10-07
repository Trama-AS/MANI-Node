const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const TokenService = require('../../../src/infrastructure/security/TokenService');

const SECRET = 'test-secret-for-token-service-32chars!!';

function signToken(payload, options = {}) {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options });
}

function tokenService() {
  return new TokenService({ jwtSecret: SECRET });
}

test('token firmado con la clave correcta retorna { userId, tenantId, role }', () => {
  const token = signToken({ sub: 'user-1', tenant_id: 'trama-demo', role: 'ALLY' });

  const session = tokenService().verifyToken(`Bearer ${token}`);

  assert.deepEqual(session, { userId: 'user-1', tenantId: 'trama-demo', role: 'ALLY' });
});

test('token con firma alterada/falsificada lanza UnauthorizedError TOKEN_INVALID', () => {
  const token = signToken({ sub: 'user-1', tenant_id: 'trama-demo', role: 'ALLY' });
  const tampered = token.slice(0, -2) + 'xx';

  assert.throws(
    () => tokenService().verifyToken(`Bearer ${tampered}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('token con payload manipulado (tenant_id falsificado) falla criptográficamente', () => {
  const token = signToken({ sub: 'user-1', tenant_id: 'trama-demo', role: 'ALLY' });
  const [header, , signature] = token.split('.');

  // Reemplaza el payload por uno con otro tenant_id, pero reutiliza la firma original:
  // sin la clave, es imposible generar una firma válida para el payload falsificado.
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user-1', tenant_id: 'otro-tenant', role: 'ADMIN' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const forgedToken = `${header}.${forgedPayload}.${signature}`;

  assert.throws(
    () => tokenService().verifyToken(`Bearer ${forgedToken}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});

test('token expirado lanza UnauthorizedError TOKEN_EXPIRED', () => {
  const token = signToken({ sub: 'user-1', tenant_id: 'trama-demo', role: 'ALLY' }, { expiresIn: -10 });

  assert.throws(
    () => tokenService().verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_EXPIRED');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('token sin claim tenant_id lanza error de autorización', () => {
  const token = signToken({ sub: 'user-1', role: 'ALLY' });

  assert.throws(
    () => tokenService().verifyToken(`Bearer ${token}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('sin encabezado Authorization lanza UnauthorizedError UNAUTHORIZED', () => {
  assert.throws(
    () => tokenService().verifyToken(undefined),
    (err) => {
      assert.equal(err.code, 'UNAUTHORIZED');
      return true;
    }
  );
});

test('token firmado con una clave distinta a la del servicio es rechazado', () => {
  const tokenFirmadoConOtraClave = jwt.sign(
    { sub: 'user-1', tenant_id: 'trama-demo', role: 'ADMIN' },
    'otra-clave-completamente-distinta',
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  assert.throws(
    () => tokenService().verifyToken(`Bearer ${tokenFirmadoConOtraClave}`),
    (err) => {
      assert.equal(err.code, 'TOKEN_INVALID');
      return true;
    }
  );
});
