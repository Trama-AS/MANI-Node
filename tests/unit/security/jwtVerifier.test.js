const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const JwtVerifier = require('../../../src/infrastructure/security/JwtVerifier');
const TokenService = require('../../../src/infrastructure/security/TokenService');

// SCRUM-1362: ramas de la política de firma que no pasan por validate-token.
const CLAIMS = { sub: 'user-1', app_metadata: { tenant_id: 't-1', user_role: 'aliado' } };
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const fakeJwks = { getSigningKey: (_kid, cb) => cb(null, { getPublicKey: () => publicKey }) };

const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err.code === code);

test('el issuer esperado se deriva de SUPABASE_URL sin importar las barras finales', () => {
  for (const url of ['https://p.supabase.co', 'https://p.supabase.co/', 'https://p.supabase.co///']) {
    assert.equal(new JwtVerifier({ supabaseUrl: url, jwks: fakeJwks }).issuer, 'https://p.supabase.co/auth/v1');
  }
});

test('sin SUPABASE_URL no hay JWKS ni issuer', () => {
  const verifier = new JwtVerifier({ jwtSecret: 's' });
  assert.equal(verifier.jwks, null);
  assert.equal(verifier.issuer, null);
});

test('un texto que no es JWT se rechaza como INVALID_TOKEN', async () => {
  await rejectsWith(new JwtVerifier({ jwtSecret: 's' }).verify('no-es-un-jwt'), 'INVALID_TOKEN');
});

test('HS256 sin secreto configurado se rechaza: no hay clave por omisión', async () => {
  const token = jwt.sign(CLAIMS, 'cualquier-secreto', { algorithm: 'HS256' });
  await rejectsWith(new JwtVerifier({ supabaseUrl: 'https://p.supabase.co', jwks: fakeJwks }).verify(token), 'INVALID_TOKEN');
});

test('ES256 válido con aud e iss del proyecto se acepta', async () => {
  const issuer = 'https://p.supabase.co/auth/v1';
  const token = jwt.sign(CLAIMS, privateKey, { algorithm: 'ES256', keyid: 'k1', audience: 'authenticated', issuer });
  const payload = await new JwtVerifier({ supabaseUrl: 'https://p.supabase.co', jwks: fakeJwks }).verify(token);
  assert.equal(payload.app_metadata.tenant_id, 't-1');
});

test('TokenService: un encabezado que no es "Bearer <token>" se rechaza como TOKEN_INVALID', async () => {
  const service = new TokenService({ jwtSecret: 's', supabaseUrl: undefined });
  for (const header of ['Basic abc', 'Bearer', 'Bearer a b', 'bearer abc']) {
    await rejectsWith(service.verifyToken(header), 'TOKEN_INVALID');
  }
  await rejectsWith(service.verifyToken(undefined), 'UNAUTHORIZED');
});
