process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');

const TENANT_A = 'trama-demo';
const TENANT_B = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const PDF = Buffer.from('%PDF-1.4\ncopia de la cédula');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function signToken({ sub, tenantId = TENANT_A, role = 'admin_tenant' }) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

const unico = () => `${Date.now()}.${Math.random().toString(36).slice(2)}`;

/** POST multipart con todos los datos obligatorios; `campos` pisa o quita (undefined) lo que se indique. */
function registrar(token, { campos = {}, archivo = { buffer: PDF, nombre: 'cedula.pdf', tipo: 'application/pdf' }, ruta = '/api/v1/allies/employees' } = {}) {
  const u = unico();
  const datos = {
    fullName: 'Jorge Directo',
    email: `jorge.${u}@trama.test`,
    phone: '+573001234567',
    documentType: 'CC',
    documentNumber: `doc-${u}`,
    categoriaIds: ['cat-1', 'cat-2'],
    ...campos,
  };
  let req = request(app).post(ruta);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(datos)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) req = req.field(k, item);
  }
  if (archivo) req = req.attach('documento_identidad', archivo.buffer, { filename: archivo.nombre, contentType: archivo.tipo });
  return req;
}

const admin = (sub = 'admin-usr-1', tenantId = TENANT_A) => signToken({ sub, tenantId });

test('registra con documento y categorías: 201, VERIFICADO de inmediato, tenant del token', async () => {
  const res = await registrar(admin());
  assert.equal(res.status, 201);
  assert.equal(res.body.tenantId, TENANT_A);
  assert.equal(res.body.employee.tipoAliado, 'EMPLEADO_DIRECTO');
  assert.equal(res.body.employee.estadoVerificacion, 'VERIFICADO');
  assert.equal(res.body.employee.status, 'VERIFIED');
  assert.deepEqual(res.body.employee.categoriaIds, ['cat-1', 'cat-2']);
  assert.equal(res.body.employee.documento.tipoDocumento, 'documento_identidad');
  assert.ok(res.body.temporaryPassword);
});

test('las tres rutas (Gateway, directa y admin) registran con PNG', async () => {
  for (const ruta of ['/allies/employees', '/api/v1/allies/direct-employees', '/api/v1/admin/employees']) {
    const res = await registrar(admin(), { ruta, archivo: { buffer: PNG, nombre: 'cedula.png', tipo: 'image/png' } });
    assert.equal(res.status, 201, ruta);
  }
});

test('acepta categoriaIds como JSON o separadas por coma y la categoriaId única heredada', async () => {
  for (const categoriaIds of [JSON.stringify(['cat-1', 'cat-3']), 'cat-1,cat-3']) {
    const res = await registrar(admin(), { campos: { categoriaIds } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.employee.categoriaIds, ['cat-1', 'cat-3']);
  }
  const res = await registrar(admin(), { campos: { categoriaIds: undefined, categoriaId: 'cat-2' } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.employee.categoriaIds, ['cat-2']);
});

test('sin Authorization → 401', async () => {
  const res = await registrar(null);
  assert.equal(res.status, 401);
});

test('token expirado o firmado con otro secreto → 401', async () => {
  const claims = { sub: 'admin-1', app_metadata: { tenant_id: TENANT_A, user_role: 'admin_tenant' } };
  const expirado = jwt.sign(claims, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: -60 });
  const ajeno = jwt.sign(claims, 'otro-secreto-invalido', { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal((await registrar(expirado)).status, 401);
  assert.equal((await registrar(ajeno)).status, 401);
});

test('C2: roles distintos de administrador (aliado, cliente) → 403 y no se crea nada', async () => {
  for (const role of ['aliado', 'cliente']) {
    const email = `ilegal.${unico()}@trama.test`;
    const res = await registrar(signToken({ sub: `usr-${role}`, role }), { campos: { email } });
    assert.equal(res.status, 403, role);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.equal(await container.usuarioRepository.findByEmail(TENANT_A, email), null);
  }
});

test('C3: no se elevan privilegios: un rol en el cuerpo se ignora y el empleado es ALIADO', async () => {
  const email = `rol.${unico()}@trama.test`;
  const res = await registrar(admin(), { campos: { email, role: 'ADMIN', rol: 'ADMIN_TENANT' } });
  assert.equal(res.status, 201);
  const usuario = await container.usuarioRepository.findByEmail(TENANT_A, email);
  assert.equal(usuario.rol, 'ALLY');
});

test('C3 / ADR-0018: el tenant sale solo del JWT; el del cuerpo, la consulta y el encabezado se ignoran', async () => {
  const email = `tenant.${unico()}@trama.test`;
  const res = await registrar(admin(), { campos: { email, tenantId: TENANT_B, tenant_id: TENANT_B } })
    .query({ tenantId: TENANT_B })
    .set('X-Tenant-Id', TENANT_B)
    .set('X-Tenant-Slug', 'plomeria-express');
  assert.equal(res.status, 201);
  assert.equal(res.body.tenantId, TENANT_A);
  assert.equal(res.body.employee.tenantId, TENANT_A);
  assert.ok(await container.usuarioRepository.findByEmail(TENANT_A, email));
  assert.equal(await container.usuarioRepository.findByEmail(TENANT_B, email), null);
});

test('C2: documento de identidad repetido en el tenant → 409; en otro tenant sí se puede', async () => {
  const campos = { documentNumber: `rep-${unico()}` };
  assert.equal((await registrar(admin(), { campos })).status, 201);
  const repetido = await registrar(admin(), { campos });
  assert.equal(repetido.status, 409);
  assert.equal(repetido.body.code, 'DOCUMENT_ALREADY_REGISTERED');
  const otroTenant = await registrar(admin('admin-b', TENANT_B), { campos });
  assert.equal(otroTenant.status, 201);
  assert.equal(otroTenant.body.tenantId, TENANT_B);
});

test('C2: email repetido en el tenant → 409', async () => {
  const campos = { email: `dup.${unico()}@trama.test` };
  assert.equal((await registrar(admin(), { campos })).status, 201);
  const res = await registrar(admin(), { campos });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('documento obligatorio: sin archivo → 400 DOCUMENT_REQUIRED', async () => {
  const res = await registrar(admin(), { archivo: null });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'DOCUMENT_REQUIRED');
});

test('documento: tipo no permitido → 400; contenido que no corresponde → 400', async () => {
  const gif = await registrar(admin(), { archivo: { buffer: Buffer.from('GIF89a....'), nombre: 'a.gif', tipo: 'image/gif' } });
  assert.equal(gif.status, 400);
  assert.equal(gif.body.code, 'DOCUMENT_TYPE_INVALID');
  const falso = await registrar(admin(), { archivo: { buffer: Buffer.from('texto'), nombre: 'a.pdf', tipo: 'application/pdf' } });
  assert.equal(falso.status, 400);
  assert.equal(falso.body.code, 'DOCUMENT_TYPE_INVALID');
});

test('documento de más de 5 MB → 413 DOCUMENT_TOO_LARGE', async () => {
  const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]);
  const res = await registrar(admin(), { archivo: { buffer: grande, nombre: 'grande.pdf', tipo: 'application/pdf' } });
  assert.equal(res.status, 413);
  assert.equal(res.body.code, 'DOCUMENT_TOO_LARGE');
});

test('datos obligatorios: sin teléfono, tipo/número de documento o categorías → 400', async () => {
  for (const campo of ['phone', 'documentType', 'documentNumber', 'categoriaIds']) {
    const res = await registrar(admin(), { campos: { [campo]: undefined } });
    assert.equal(res.status, 400, campo);
    assert.equal(res.body.code, 'VALIDATION_ERROR', campo);
  }
});

test('categoría inexistente → 400 CATEGORY_NOT_FOUND', async () => {
  const res = await registrar(admin(), { campos: { categoriaIds: ['cat-1', 'no-existe'] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CATEGORY_NOT_FOUND');
});

test('T10: la operación se audita con quién, cuándo y el correlationId de la petición', async () => {
  const entradas = [];
  const original = container.registerDirectEmployeeUseCase.auditLogger;
  container.registerDirectEmployeeUseCase.auditLogger = (e) => entradas.push(e);
  try {
    const res = await registrar(admin('admin-auditor')).set('X-Correlation-ID', 'corr-1376');
    assert.equal(res.status, 201);
  } finally {
    container.registerDirectEmployeeUseCase.auditLogger = original;
  }
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].event, 'US-02.1.5.registrar_empleado_directo');
  assert.equal(entradas[0].realizado_por, 'admin-auditor');
  assert.equal(entradas[0].tenant_id, TENANT_A);
  assert.equal(entradas[0].correlation_id, 'corr-1376');
  assert.ok(!Number.isNaN(Date.parse(entradas[0].fecha)));
});
