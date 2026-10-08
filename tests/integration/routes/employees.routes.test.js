const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signToken({ sub, tenantId, role }) {
  return jwt.sign(
    {
      sub,
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: '1h',
    }
  );
}

test('POST /api/v1/allies/employees con token ADMIN_TENANT registra empleado directo y responde 201', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-1',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      fullName: 'Jorge Directo',
      email: `jorge.${unique}@trama.test`,
      phone: '+573001234567',
      documentType: 'CC',
      documentNumber: `doc-${unique}`,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.tenantId, 'trama-demo');
  assert.equal(res.body.employee.fullName, 'Jorge Directo');
  assert.equal(res.body.employee.tipoAliado, 'EMPLEADO_DIRECTO');
  assert.equal(res.body.employee.estadoVerificacion, 'VERIFICADO');
  assert.equal(res.body.employee.status, 'VERIFIED');
  assert.ok(res.body.temporaryPassword);
});

test('POST /allies/employees (ruta raíz sin prefijo para API Gateway) responde 201', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-2',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      nombre: 'Sandra Empleada',
      email: `sandra.${unique}@trama.test`,
      telefono: '+573117654321',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.employee.nombre, 'Sandra Empleada');
  assert.equal(res.body.employee.tipoAliado, 'EMPLEADO_DIRECTO');
});

test('POST /api/v1/admin/employees alias de administracion responde 201', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-3',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/admin/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      fullName: 'Marcos Empleado',
      email: `marcos.${unique}@trama.test`,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.employee.fullName, 'Marcos Empleado');
});

test('POST /api/v1/allies/employees sin Authorization responde 401', async () => {
  const res = await request(app)
    .post('/api/v1/allies/employees')
    .send({
      fullName: 'Sin Auth',
      email: 'sinauth@trama.test',
    });

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('POST /api/v1/allies/employees con rol no-admin (cliente o aliado) responde 403', async () => {
  const allyToken = signToken({
    sub: 'ally-usr-1',
    tenantId: 'trama-demo',
    role: 'aliado',
  });

  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${allyToken}`)
    .send({
      fullName: 'Intento Ilegal',
      email: 'ilegal@trama.test',
    });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('ADR-0018: el tenantId proviene exclusivamente del token JWT, ignorando o aislando inputs externos', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-4',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('X-Tenant-Id', 'tenant-falso-en-header')
    .send({
      fullName: 'Tenant Isolation Test',
      email: `tenant.iso.${unique}@trama.test`,
      tenantId: 'tenant-falso-en-body',
    });

  assert.equal(res.status, 201);
  // El tenant asociado es ESTRICTAMENTE el del claim del token
  assert.equal(res.body.tenantId, 'trama-demo');
  assert.equal(res.body.employee.tenantId, 'trama-demo');
});

test('POST /api/v1/allies/employees con payload inválido responde 400', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-5',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      fullName: 'A', // Demasiado corto
      email: 'no-es-un-email',
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/allies/employees con email duplicado responde 409', async () => {
  const adminToken = signToken({
    sub: 'admin-usr-6',
    tenantId: 'trama-demo',
    role: 'admin_tenant',
  });

  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const email = `duplicado.${unique}@trama.test`;

  const res1 = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      fullName: 'Primer Registro',
      email,
    });
  assert.equal(res1.status, 201);

  const res2 = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      fullName: 'Segundo Registro Mismo Email',
      email,
    });

  assert.equal(res2.status, 409);
  assert.equal(res2.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('POST /api/v1/allies/employees con token expirado responde 401', async () => {
  const token = jwt.sign(
    { sub: 'admin-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'admin_tenant' } },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn: -60 }
  );
  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: 'Ana Pérez', email: 'ana@x.com' });
  assert.equal(res.status, 401);
});

test('POST /api/v1/allies/employees con token firmado con secreto distinto responde 401', async () => {
  const token = jwt.sign(
    { sub: 'admin-1', app_metadata: { tenant_id: 'trama-demo', user_role: 'admin_tenant' } },
    'otro-secreto-invalido',
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const res = await request(app)
    .post('/api/v1/allies/employees')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: 'Ana Pérez', email: 'ana@x.com' });
  assert.equal(res.status, 401);
});

