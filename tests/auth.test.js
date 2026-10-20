const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

// El router resuelve el secreto al cargarse y falla si falta fuera de desarrollo/pruebas.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const authRoutes = require('../src/routes/auth.routes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', authRoutes);
  return app;
}

describe('CFG-22: Validación de Autenticación y Claims de Tenant en Gateway y Core', () => {
  const { resolveJwtSecret } = require('../src/config/jwtSecret');
  const JWT_SECRET = resolveJwtSecret();

  test('Rechaza petición sin encabezado Authorization con 401', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'UNAUTHORIZED');
    } finally {
      server.close();
    }
  });

  test('Rechaza token que NO contiene el claim obligatorio tenant_id con 401', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    // Token sin tenant_id en app_metadata ni en raíz
    const invalidToken = jwt.sign(
      { sub: 'usr-no-tenant', role: 'authenticated' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: `Bearer ${invalidToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'MISSING_TENANT_CLAIM');
    } finally {
      server.close();
    }
  });

  test('Acepta token válido con tenant_id y propaga encabezados X-Tenant-Id y X-User-Role', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    const validToken = jwt.sign(
      {
        sub: 'usr-12345',
        role: 'authenticated',
        app_metadata: {
          tenant_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          user_role: 'aliado',
        },
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-tenant-id'), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
      assert.equal(res.headers.get('x-user-role'), 'aliado');
      assert.equal(res.headers.get('x-user-id'), 'usr-12345');

      const data = await res.json();
      assert.equal(data.valid, true);
      assert.equal(data.tenantId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
      assert.equal(data.role, 'aliado');
    } finally {
      server.close();
    }
  });

  test('POST /auth/dev-token emite token válido verificable por validate-token', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const issueRes = await fetch(`http://localhost:${port}/api/v1/auth/dev-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'tenant-mani-test', role: 'cliente', userId: 'client-555' }),
      });
      assert.equal(issueRes.status, 200);
      const issued = await issueRes.json();
      assert.ok(issued.token);

      const validateRes = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      assert.equal(validateRes.status, 200);
      assert.equal(validateRes.headers.get('x-tenant-id'), 'tenant-mani-test');
      assert.equal(validateRes.headers.get('x-user-role'), 'cliente');
    } finally {
      server.close();
    }
  });

  test('Rechaza token con firma inválida o secreto adulterado con 401 INVALID_SIGNATURE', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    const forgedToken = jwt.sign(
      {
        sub: 'usr-attacker',
        role: 'authenticated',
        app_metadata: { tenant_id: 'tenant-victim', user_role: 'admin' },
      },
      'secreto-completamente-falso-y-erroneo',
      { expiresIn: '1h' }
    );

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'INVALID_SIGNATURE');
    } finally {
      server.close();
    }
  });

  test('Rechaza token expirado con 401 TOKEN_EXPIRED', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    const expiredToken = jwt.sign(
      {
        sub: 'usr-expired',
        role: 'authenticated',
        app_metadata: { tenant_id: 'tenant-mani', user_role: 'cliente' },
      },
      JWT_SECRET,
      { expiresIn: '-10s' } // Expirado hace 10 segundos
    );

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'TOKEN_EXPIRED');
    } finally {
      server.close();
    }
  });

  test('Rechaza encabezado Authorization sin formato Bearer con 401', async () => {
    const app = makeApp();
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/auth/validate-token`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'UNAUTHORIZED');
    } finally {
      server.close();
    }
  });
});
