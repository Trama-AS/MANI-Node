// SCRUM-1333 (BUG-SEC-01): regresiones de cada vía de falsificación de JWT
// reproducida contra Core el 2026-10-18. Todas deben fallar cerrado.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

// Importar el módulo construye el router por defecto, que exige secreto o NODE_ENV de desarrollo.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { createAuthRouter } = require('../src/routes/auth.routes');
const { resolveJwtSecret, isDevTokenEnabled, JwtConfigurationError, INSECURE_DEV_SECRET } = require('../src/config/jwtSecret');

const REAL_SECRET = 'secreto-real-de-este-ambiente-32-caracteres';
const TENANT = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const GOOD_CLAIMS = { sub: 'usr-1', app_metadata: { tenant_id: TENANT, user_role: 'aliado' } };

async function withApp(env, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createAuthRouter(env));
  const server = app.listen(0);
  try {
    return await run(`http://localhost:${server.address().port}/api/v1`);
  } finally {
    server.close();
  }
}

const validate = (base, token) => fetch(`${base}/auth/validate-token`, { headers: { Authorization: `Bearer ${token}` } });

describe('El secreto JWT nunca degrada a un valor conocido', () => {
  for (const nodeEnv of [undefined, '', 'production', 'qa', 'staging', 'Production']) {
    test(`sin SUPABASE_JWT_SECRET y NODE_ENV=${JSON.stringify(nodeEnv)} el servicio no se construye`, () => {
      assert.throws(() => createAuthRouter({ NODE_ENV: nodeEnv }), JwtConfigurationError);
      assert.throws(() => resolveJwtSecret({ NODE_ENV: nodeEnv }), /SUPABASE_JWT_SECRET es obligatorio/);
    });
  }

  test('un secreto en blanco cuenta como ausente', () => {
    assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: '   ' }), JwtConfigurationError);
  });

  test('JWT_SECRET (alias antiguo) ya no se acepta como sustituto', () => {
    assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: REAL_SECRET }), JwtConfigurationError);
  });

  test('solo NODE_ENV=development|test explícito permite el secreto inseguro de desarrollo', () => {
    assert.equal(resolveJwtSecret({ NODE_ENV: 'development' }), INSECURE_DEV_SECRET);
    assert.equal(resolveJwtSecret({ NODE_ENV: 'TEST' }), INSECURE_DEV_SECRET);
  });

  test('con el secreto configurado se usa ese, aun en desarrollo', () => {
    assert.equal(resolveJwtSecret({ NODE_ENV: 'development', SUPABASE_JWT_SECRET: REAL_SECRET }), REAL_SECRET);
  });

  test('el proceso real no arranca en producción sin secreto (código de salida distinto de 0)', () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { ...process.env, NODE_ENV: 'production', SUPABASE_JWT_SECRET: '', PORT: '0' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SUPABASE_JWT_SECRET/);
    assert.doesNotMatch(result.stdout, /corriendo en el puerto/);
  });
});

describe('/auth/dev-token no existe fuera de desarrollo y pruebas', () => {
  for (const nodeEnv of ['production', 'qa', 'staging']) {
    test(`NODE_ENV=${nodeEnv} con secreto real: 404, no emite tokens`, async () => {
      assert.equal(isDevTokenEnabled({ NODE_ENV: nodeEnv }), false);
      await withApp({ NODE_ENV: nodeEnv, SUPABASE_JWT_SECRET: REAL_SECRET }, async (base) => {
        const res = await fetch(`${base}/auth/dev-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: 'tenant-ajeno', role: 'admin_tenant' }),
        });
        assert.equal(res.status, 404);
      });
    });
  }

  test('NODE_ENV=development sigue emitiendo tokens verificables (uso local y pruebas)', async () => {
    await withApp({ NODE_ENV: 'development', SUPABASE_JWT_SECRET: REAL_SECRET }, async (base) => {
      const issued = await (await fetch(`${base}/auth/dev-token`, { method: 'POST' })).json();
      const res = await validate(base, issued.token);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-tenant-id'), TENANT);
    });
  });
});

describe('validate-token rechaza toda falsificación', () => {
  const env = { NODE_ENV: 'production', SUPABASE_JWT_SECRET: REAL_SECRET };

  test('token firmado con el secreto por defecto publicado en el repositorio', async () => {
    await withApp(env, async (base) => {
      const forged = jwt.sign(GOOD_CLAIMS, INSECURE_DEV_SECRET);
      const res = await validate(base, forged);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'INVALID_SIGNATURE');
      assert.equal(res.headers.get('x-tenant-id'), null);
    });
  });

  test('token con claims en la raíz y sin app_metadata (tenant_id / role de la raíz)', async () => {
    await withApp(env, async (base) => {
      const rootClaims = jwt.sign({ sub: 'x', tenant_id: 'raiz-t', user_role: 'admin_tenant', role: 'admin_tenant' }, REAL_SECRET);
      const res = await validate(base, rootClaims);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'MISSING_TENANT_CLAIM');
      assert.equal(res.headers.get('x-tenant-id'), null);
    });
  });

  test('token firmado correctamente pero sin app_metadata.user_role: no se asume "authenticated"', async () => {
    await withApp(env, async (base) => {
      const res = await validate(base, jwt.sign({ sub: 'x', app_metadata: { tenant_id: TENANT } }, REAL_SECRET));
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'INVALID_TOKEN');
      assert.equal(res.headers.get('x-user-role'), null);
    });
  });

  test('token firmado correctamente pero sin sub: no se asume "anonymous-user"', async () => {
    await withApp(env, async (base) => {
      const res = await validate(base, jwt.sign({ app_metadata: { tenant_id: TENANT, user_role: 'aliado' } }, REAL_SECRET));
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'INVALID_TOKEN');
    });
  });

  test('tenant_id que no es una cadena (objeto, número, vacío) se rechaza', async () => {
    await withApp(env, async (base) => {
      for (const bad of [{ a: 1 }, 123, '', '   ', null]) {
        const res = await validate(base, jwt.sign({ sub: 'x', app_metadata: { tenant_id: bad, user_role: 'aliado' } }, REAL_SECRET));
        assert.equal(res.status, 401, `tenant_id=${JSON.stringify(bad)}`);
      }
    });
  });

  test('algoritmo distinto de HS256 (HS512) y "alg: none" se rechazan', async () => {
    await withApp(env, async (base) => {
      const hs512 = jwt.sign(GOOD_CLAIMS, REAL_SECRET, { algorithm: 'HS512' });
      assert.equal((await validate(base, hs512)).status, 401);

      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(GOOD_CLAIMS)}.`;
      assert.equal((await validate(base, none)).status, 401);
    });
  });

  test('control positivo: token válido de app_metadata propaga tenant, rol y usuario', async () => {
    await withApp(env, async (base) => {
      const res = await validate(base, jwt.sign(GOOD_CLAIMS, REAL_SECRET, { expiresIn: '1h' }));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-tenant-id'), TENANT);
      assert.equal(res.headers.get('x-user-role'), 'aliado');
      assert.equal(res.headers.get('x-user-id'), 'usr-1');
    });
  });
});

// SCRUM-1362 (BUG-SEC-04): Supabase Auth firma los tokens de acceso con ES256 y
// validate-token solo aceptaba HS256, así que ningún usuario real pasaba el
// Gateway. Aquí el JWKS lo publica un servidor HTTP local en la misma ruta que
// Supabase (/auth/v1/.well-known/jwks.json): se prueba el cliente jwks-rsa real.
describe('validate-token acepta tokens ES256 de Supabase Auth verificados con el JWKS (SCRUM-1362)', () => {
  const http = require('node:http');
  const crypto = require('node:crypto');

  const KID = 'kid-qa-1';
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const intruder = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

  async function withSupabase(run) {
    let jwksRequests = 0;
    const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' }] };
    const server = http.createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        jwksRequests += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(jwks));
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const supabaseUrl = `http://localhost:${server.address().port}`;
    try {
      return await run({ supabaseUrl, issuer: `${supabaseUrl}/auth/v1`, jwksRequests: () => jwksRequests });
    } finally {
      server.close();
    }
  }

  const es256 = (claims, { issuer, key = privateKey, kid = KID, audience = 'authenticated', expiresIn = '1h' }) =>
    jwt.sign({ role: 'authenticated', ...claims }, key, { algorithm: 'ES256', keyid: kid, audience, issuer, expiresIn });

  const envFor = (supabaseUrl) => ({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: REAL_SECRET, SUPABASE_URL: supabaseUrl });

  test('token ES256 válido de Supabase Auth: 200 y propaga tenant, rol y usuario', async () => {
    await withSupabase(async ({ supabaseUrl, issuer, jwksRequests }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const token = es256(GOOD_CLAIMS, { issuer });
        const res = await validate(base, token);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-tenant-id'), TENANT);
        assert.equal(res.headers.get('x-user-role'), 'aliado');
        assert.equal(res.headers.get('x-user-id'), 'usr-1');

        // El JWKS se cachea: una segunda validación no vuelve a descargarlo.
        assert.equal((await validate(base, token)).status, 200);
        assert.equal(jwksRequests(), 1);
      });
    });
  });

  test('una barra final en SUPABASE_URL no cambia el issuer esperado', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(`${supabaseUrl}/`), async (base) => {
        assert.equal((await validate(base, es256(GOOD_CLAIMS, { issuer }))).status, 200);
      });
    });
  });

  test('ES256 con firma alterada o firmado con otra clave bajo el mismo kid: 401 INVALID_SIGNATURE', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const token = es256(GOOD_CLAIMS, { issuer });
        const [h, p, s] = token.split('.');
        const flipped = s[10] === 'A' ? 'B' : 'A';
        const tampered = `${h}.${p}.${s.slice(0, 10)}${flipped}${s.slice(11)}`;
        const forged = es256(
          { ...GOOD_CLAIMS, app_metadata: { tenant_id: 'otro', user_role: 'admin_tenant' } },
          { issuer, key: intruder.privateKey }
        );
        for (const bad of [tampered, forged]) {
          const res = await validate(base, bad);
          assert.equal(res.status, 401);
          assert.equal((await res.json()).error, 'INVALID_SIGNATURE');
          assert.equal(res.headers.get('x-tenant-id'), null);
        }
      });
    });
  });

  test('ES256 con kid desconocido o sin kid: 401', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        assert.equal((await validate(base, es256(GOOD_CLAIMS, { issuer, kid: 'kid-ajeno' }))).status, 401);
        const sinKid = jwt.sign(GOOD_CLAIMS, privateKey, {
          algorithm: 'ES256',
          audience: 'authenticated',
          issuer,
          expiresIn: '1h',
        });
        assert.equal((await validate(base, sinKid)).status, 401);
      });
    });
  });

  test('ES256 de otro proyecto (iss) o con otra audiencia (aud): 401', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const otroProyecto = es256(GOOD_CLAIMS, { issuer: 'https://otro.supabase.co/auth/v1' });
        assert.equal((await validate(base, otroProyecto)).status, 401);
        assert.equal((await validate(base, es256(GOOD_CLAIMS, { issuer, audience: 'anon' }))).status, 401);
      });
    });
  });

  test('ES256 expirado: 401 TOKEN_EXPIRED', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const res = await validate(base, es256(GOOD_CLAIMS, { issuer, expiresIn: -10 }));
        assert.equal(res.status, 401);
        assert.equal((await res.json()).error, 'TOKEN_EXPIRED');
      });
    });
  });

  test('ES256 válido sin app_metadata.tenant_id: 401 MISSING_TENANT_CLAIM (SCRUM-1333 se mantiene)', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const sinTenant = es256({ sub: 'usr-1', tenant_id: TENANT, app_metadata: { user_role: 'aliado' } }, { issuer });
        const res = await validate(base, sinTenant);
        assert.equal(res.status, 401);
        assert.equal((await res.json()).error, 'MISSING_TENANT_CLAIM');
      });
    });
  });

  test('alg confusion: HS256 firmado con la clave pública del JWKS como secreto se rechaza', async () => {
    await withSupabase(async ({ supabaseUrl, issuer }) => {
      await withApp(envFor(supabaseUrl), async (base) => {
        const pem = publicKey.export({ format: 'pem', type: 'spki' });
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const unsigned = `${b64({ alg: 'HS256', typ: 'JWT', kid: KID })}.${b64({ ...GOOD_CLAIMS, iss: issuer, aud: 'authenticated' })}`;
        const sig = crypto.createHmac('sha256', pem).update(unsigned).digest('base64url');
        const res = await validate(base, `${unsigned}.${sig}`);
        assert.equal(res.status, 401);
        assert.equal(res.headers.get('x-tenant-id'), null);
      });
    });
  });

  test('sin SUPABASE_URL no hay JWKS: un ES256 se rechaza y HS256 sigue funcionando', async () => {
    await withSupabase(async ({ issuer }) => {
      await withApp({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: REAL_SECRET }, async (base) => {
        assert.equal((await validate(base, es256(GOOD_CLAIMS, { issuer }))).status, 401);
        assert.equal((await validate(base, jwt.sign(GOOD_CLAIMS, REAL_SECRET, { expiresIn: '1h' }))).status, 200);
      });
    });
  });

  test('JWKS inalcanzable: 401, nunca 200 (falla cerrado)', async () => {
    await withApp(envFor('http://127.0.0.1:9'), async (base) => {
      const res = await validate(base, es256(GOOD_CLAIMS, { issuer: 'http://127.0.0.1:9/auth/v1' }));
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('x-tenant-id'), null);
    });
  });
});
