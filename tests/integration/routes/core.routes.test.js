const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const Profile = require('../../../src/domain/entities/Profile');
const { startFakeRulesService } = require('../../helpers/fakeRulesService');

let rules;

before(async () => {
  rules = await startFakeRulesService();
  container.ruleEvaluationService.baseUrl = rules.url;
});

beforeEach(() => rules.reset());

after(async () => {
  await rules.close();
});

function signTestToken({ sub, tenantId, role }) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// ---- SCRUM-1364 (HU-M01-01): el listado global de tenants no se enumera ----

const TENANT_A = 'trama-demo';
const TENANT_B = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const bearerOf = (opts) => `Bearer ${signTestToken(opts)}`;

test('C2: GET /api/v1/tenants sin sesión responde 401 y no devuelve datos', async () => {
  const res = await request(app).get('/api/v1/tenants');

  assert.equal(res.status, 401);
  assert.equal(res.body.data, undefined);
});

test('C2: ningún rol de tenant puede listar todos los tenants (403 sin datos), ni siquiera el admin del tenant', async () => {
  for (const role of ['cliente', 'aliado', 'admin_tenant']) {
    const res = await request(app).get('/api/v1/tenants').set('Authorization', bearerOf({ sub: 'u-1', tenantId: TENANT_A, role }));

    assert.equal(res.status, 403, `rol ${role}`);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.equal(res.body.data, undefined, `rol ${role} no debe recibir tenants`);
    assert.equal(JSON.stringify(res.body).includes('Plomería'), false, 'la respuesta no nombra a otros tenants');
  }
});

test('C3: solo el permiso explícito de plataforma lista todos los tenants', async () => {
  const res = await request(app).get('/api/v1/tenants').set('Authorization', bearerOf({ sub: 'root-1', tenantId: TENANT_A, role: 'admin_plataforma' }));

  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 2);
  assert.ok(res.body.data.some((t) => t.id === TENANT_B));
});

test('C1: el perfil trae el nombre del propio tenant y no el de otros', async () => {
  container.profileRepository.profiles.push(
    new Profile({ id: 'user-b', userId: 'user-b', role: 'CLIENT', fullName: 'Cliente B', status: 'VERIFIED', tenantId: TENANT_B })
  );

  const a = await request(app).get('/api/v1/profiles/me').set('Authorization', bearerOf({ sub: 'demo-user-1', tenantId: TENANT_A, role: 'cliente' }));
  const b = await request(app).get('/api/v1/profiles/me').set('Authorization', bearerOf({ sub: 'user-b', tenantId: TENANT_B, role: 'cliente' }));

  assert.equal(a.status, 200);
  assert.equal(a.body.profile.tenantName, 'TRAMA Servicios Demo');
  assert.equal(b.status, 200);
  assert.equal(b.body.profile.tenantName, 'Plomería Express CDMX SA');
  assert.equal(JSON.stringify(a.body).includes('Plomería'), false, 'el tenant A no ve el nombre del B');
  assert.equal(JSON.stringify(b.body).includes('TRAMA'), false, 'el tenant B no ve el nombre del A');
});

test('C1: un usuario del tenant B no obtiene el perfil de un usuario del tenant A (404)', async () => {
  const res = await request(app).get('/api/v1/profiles/me').set('Authorization', bearerOf({ sub: 'demo-user-1', tenantId: TENANT_B, role: 'cliente' }));

  assert.equal(res.status, 404);
  assert.equal(res.body.profile, undefined);
});

test('GET /api/v1/profiles/me sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me con Authorization responde 200', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.profile.role, 'CLIENT');
});

test('GET /api/v1/profiles/me con un token sin firma válida responde 401', async () => {
  const res = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', 'Bearer token-demo');

  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'TOKEN_INVALID');
});

test('GET /api/v1/catalog con X-Tenant-Slug responde 200 con las categorias activas del tenant', async () => {
  const res = await request(app).get('/api/v1/catalog').set('X-Tenant-Slug', 'trama-demo');

  assert.equal(res.status, 200);
  assert.ok(res.body.categories.length > 0);
  assert.ok(res.body.categories.every((c) => c.active === true));
});

test('GET /api/v1/catalog sin X-Tenant-Slug (o con un slug inexistente) responde 200 con lista vacía', async () => {
  const tenantId = 'tenant-catalogo-publico';
  await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Solo Este Tenant', flujoOperativo: 'TARIFA_ESTANDAR' });

  const sinSlug = await request(app).get('/api/v1/catalog');
  assert.equal(sinSlug.status, 200);
  assert.deepEqual(sinSlug.body.categories, []);

  const slugInexistente = await request(app).get('/api/v1/catalog').set('X-Tenant-Slug', 'no-existe');
  assert.equal(slugInexistente.status, 200);
  assert.deepEqual(slugInexistente.body.categories, []);
});

test('GET /api/v1/catalog muestra las categorías propias del tenant del slug, y no las inactivas', async () => {
  const activa = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('trama-demo')}`)
    .send({ name: 'Vitrina Activa', flujoOperativo: 'TARIFA_ESTANDAR' });
  const inactiva = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('trama-demo')}`)
    .send({ name: 'Vitrina Inactiva', flujoOperativo: 'TARIFA_ESTANDAR' });
  await request(app)
    .patch(`/api/v1/catalog/categories/${inactiva.body.category.id}/deactivate`)
    .set('Authorization', `Bearer ${adminToken('trama-demo')}`);

  const res = await request(app).get('/api/v1/catalog').set('X-Tenant-Slug', 'trama-demo');
  const ids = res.body.categories.map((c) => c.id);

  assert.ok(ids.includes(activa.body.category.id));
  assert.ok(!ids.includes(inactiva.body.category.id));
});

test('GET /api/v1/catalog con X-Tenant-Slug de otro tenant no filtra las categorías del tenant propio', async () => {
  const tenantId = 'tenant-catalogo-aislado';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Privada Del Tenant', flujoOperativo: 'TARIFA_ESTANDAR' });

  const mismoTenantRes = await request(app).get('/api/v1/catalog').set('X-Tenant-Slug', 'trama-demo');
  const otroTenantRes = await request(app).get('/api/v1/catalog').set('X-Tenant-Slug', 'plomeria-express');

  assert.ok(!mismoTenantRes.body.categories.some((c) => c.id === createRes.body.category.id));
  assert.ok(!otroTenantRes.body.categories.some((c) => c.id === createRes.body.category.id));
});

test('GET /ruta-inexistente responde 404', async () => {
  const res = await request(app).get('/ruta-inexistente');

  assert.equal(res.status, 404);
});

// --- Categorías atendidas por el aliado (US-03.1.3 / SCRUM-859) ---

test('GET /api/v1/profiles/me/categories sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/categories');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me/categories con rol CLIENT responde 403 (MANI-CAT-403)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-CAT-403');
});

test('GET /api/v1/profiles/me/categories con rol ALLY responde 200 y retorna sus categorías', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.categories));
  assert.ok(res.body.categories.includes('cat-1'));
});

test('GET /api/v1/profiles/me/categories/available sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/categories/available');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me/categories/available con rol CLIENT responde 403 (MANI-CAT-403)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories/available')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-CAT-403');
});

test('GET /api/v1/profiles/me/categories/available con rol ALLY lista solo categorías activas, ordenadas, con id y name', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories/available')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  const ids = res.body.categories.map((c) => c.id);
  assert.ok(ids.includes('cat-1'));
  assert.ok(!ids.includes('cat-inactive'), 'una categoría inactiva no debe ofrecerse');
  for (const c of res.body.categories) assert.deepEqual(Object.keys(c).sort(), ['id', 'name']);
  const names = res.body.categories.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'es')));
});

test('PUT /api/v1/profiles/me/categories con lista vacía responde 422 (MANI-CAT-422V)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: [] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422V');
});

test('PUT /api/v1/profiles/me/categories con categoría inexistente responde 422 (MANI-CAT-422C)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: ['cat-1', 'cat-inexistente'] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422C');
});

test('PUT /api/v1/profiles/me/categories con categoría inactiva responde 422 (MANI-CAT-422C)', async () => {
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('trama-demo')}`)
    .send({ name: 'Categoria Inactiva Aliado', flujoOperativo: 'TARIFA_ESTANDAR' });
  const inactiveCategoryId = createRes.body.category.id;
  await request(app)
    .patch(`/api/v1/catalog/categories/${inactiveCategoryId}/deactivate`)
    .set('Authorization', `Bearer ${adminToken('trama-demo')}`);

  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: [inactiveCategoryId] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422C');
});

test('PUT /api/v1/profiles/me/categories con categorías válidas actualiza exitosamente', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: ['cat-1', 'cat-2'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, ['cat-1', 'cat-2']);

  // Verifica que GET posterior retorne las nuevas categorías
  const getRes = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(getRes.status, 200);
  assert.deepEqual(getRes.body.categories, ['cat-1', 'cat-2']);
});

test('POST /profiles/me/categories (alias y ruta raíz) responde 200', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .post('/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categoriaIds: ['cat-2', 'cat-3'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, ['cat-2', 'cat-3']);
});

test('PATCH /api/v1/profiles/me actualiza datos propios y persiste los cambios en GET /api/v1/profiles/me (SCRUM-854)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const patchRes = await request(app)
    .patch('/api/v1/profiles/me')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Laura Gómez',
      phone: '+57 315 222 3344',
      address: 'Carrera 15 # 85-30 Bogotá',
    });

  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.profile.fullName, 'Laura Gómez');
  assert.equal(patchRes.body.profile.phone, '+57 315 222 3344');
  assert.equal(patchRes.body.profile.address, 'Carrera 15 # 85-30 Bogotá');

  const getRes = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.profile.fullName, 'Laura Gómez');
  assert.equal(getRes.body.profile.phone, '+57 315 222 3344');
});

test('No existe ruta para editar el perfil de otro usuario, y un cambio de rol responde 403 MANI-PRF-403 (SCRUM-854)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  for (const method of ['patch', 'put']) {
    const foreignRes = await request(app)[method]('/api/v1/profiles/demo-ally-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Intruso' });
    assert.equal(foreignRes.status, 404);
  }

  const putMe = await request(app).put('/api/v1/profiles/me').set('Authorization', `Bearer ${token}`).send({ fullName: 'Laura' });
  assert.equal(putMe.status, 404);

  const privRes = await request(app)
    .patch('/api/v1/profiles/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName: 'Laura', role: 'ADMIN' });

  assert.equal(privRes.status, 403);
  assert.equal(privRes.body.code, 'MANI-PRF-403');
});

test('POST /api/v1/profiles/me/photo permite subir foto en formato soportado y rechaza formato inválido (SCRUM-1028 / SCRUM-1030)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const okRes = await request(app)
    .post('/api/v1/profiles/me/photo')
    .set('Authorization', `Bearer ${token}`)
    .attach('photo', Buffer.from('fake-png-bytes'), { filename: 'avatar.png', contentType: 'image/png' });

  assert.equal(okRes.status, 200);
  assert.match(okRes.body.profile.photoUrl, /^trama-demo\/demo-ally-1\/avatar-/);

  const badRes = await request(app)
    .post('/api/v1/profiles/me/photo')
    .set('Authorization', `Bearer ${token}`)
    .attach('photo', Buffer.from('fake-pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

  assert.equal(badRes.status, 400);
  assert.equal(badRes.body.code, 'MANI-PRF-422');
});


test('PATCH /api/v1/profiles/me rechaza una URL de foto en el cuerpo: la foto solo entra por subida (SCRUM-854)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  for (const field of ['photoUrl', 'fotoUrl', 'foto_url']) {
    const res = await request(app)
      .patch('/api/v1/profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Laura Gómez', [field]: 'https://evil.example/x.png' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'MANI-PRF-422');
  }
});

test('POST /api/v1/profiles/me/photo sin archivo responde 400 MANI-PRF-422 (SCRUM-854)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .post('/api/v1/profiles/me/photo')
    .set('Authorization', `Bearer ${token}`)
    .send({ photoUrl: 'https://evil.example/x.png' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-PRF-422');
});

test('POST /api/v1/profiles/me/photo sin Authorization responde 401 (SCRUM-854)', async () => {
  const res = await request(app)
    .post('/api/v1/profiles/me/photo')
    .attach('photo', Buffer.from('fake-png-bytes'), { filename: 'avatar.png', contentType: 'image/png' });

  assert.equal(res.status, 401);
});

// --- Gestión de categoría de servicio (US-03.1.1-M2.1) ---

function adminToken(tenantId = 'tenant-categorias-test') {
  return signTestToken({ sub: 'admin-1', tenantId, role: 'admin_tenant' });
}

test('GET /api/v1/catalog/categories sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/catalog/categories');

  assert.equal(res.status, 401);
});

test('GET /api/v1/catalog/categories con rol CLIENT responde 403 FORBIDDEN', async () => {
  const token = signTestToken({ sub: 'u1', tenantId: 'tenant-categorias-test', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('POST /api/v1/catalog/categories crea una categoría y queda aislada al tenant del token', async () => {
  const tenantId = 'tenant-categorias-crud';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', description: 'Peinados para eventos', flujoOperativo: 'TARIFA_ESTANDAR' });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.category.tenantId, tenantId);
  assert.equal(createRes.body.category.active, true);
  assert.equal(createRes.body.category.flujoOperativo, 'TARIFA_ESTANDAR');

  const listRes = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);

  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.categories.some((c) => c.id === createRes.body.category.id));

  const otroTenantRes = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('otro-tenant')}`);

  assert.equal(otroTenantRes.status, 200);
  assert.ok(!otroTenantRes.body.categories.some((c) => c.id === createRes.body.category.id));
});

test('POST /api/v1/catalog/categories sin name responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ description: 'sin nombre', flujoOperativo: 'TARIFA_ESTANDAR' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/catalog/categories sin flujoOperativo responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ name: 'Peinados' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/catalog/categories con nombre duplicado en el mismo tenant responde 409 CATEGORY_NAME_ALREADY_EXISTS', async () => {
  const tenantId = 'tenant-categorias-duplicado';
  await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: '  peinados  ', flujoOperativo: 'COTIZACION_PREVIA' });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CATEGORY_NAME_ALREADY_EXISTS');
});

test('GET /api/v1/catalog/categories/:id responde 404 CATEGORY_NOT_FOUND si es de otro tenant', async () => {
  const tenantId = 'tenant-categorias-get';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const res = await request(app)
    .get(`/api/v1/catalog/categories/${createRes.body.category.id}`)
    .set('Authorization', `Bearer ${adminToken('otro-tenant')}`);

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'CATEGORY_NOT_FOUND');
});

test('PUT /api/v1/catalog/categories/:id actualiza name/description/flujoOperativo', async () => {
  const tenantId = 'tenant-categorias-update';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  const res = await request(app)
    .put(`/api/v1/catalog/categories/${createRes.body.category.id}`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados de Novia', flujoOperativo: 'COTIZACION_PREVIA' });

  assert.equal(res.status, 200);
  assert.equal(res.body.category.name, 'Peinados de Novia');
  assert.equal(res.body.category.flujoOperativo, 'COTIZACION_PREVIA');
});

test('PATCH /api/v1/catalog/categories/:id/deactivate y /activate alternan el flujo operativo', async () => {
  const tenantId = 'tenant-categorias-flujo';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const id = createRes.body.category.id;

  const deactivateRes = await request(app)
    .patch(`/api/v1/catalog/categories/${id}/deactivate`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);
  assert.equal(deactivateRes.status, 200);
  assert.equal(deactivateRes.body.category.active, false);

  const activateRes = await request(app)
    .patch(`/api/v1/catalog/categories/${id}/activate`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.category.active, true);
});

test('PATCH /deactivate y /activate auditan con el usuario del token y el X-Correlation-ID de la petición (T10 / SCRUM-1391)', async () => {
  const tenantId = 'tenant-categorias-auditoria';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Cerrajería', flujoOperativo: 'TARIFA_ESTANDAR' });
  const id = createRes.body.category.id;

  const auditoria = [];
  const original = container.setCategoryStatusUseCase.auditLogger;
  container.setCategoryStatusUseCase.auditLogger = (entry) => auditoria.push(entry);
  try {
    const desactivar = await request(app)
      .patch(`/api/v1/catalog/categories/${id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken(tenantId)}`)
      .set('X-Correlation-ID', 'corr-auditoria-1');
    assert.equal(desactivar.status, 200);

    const activar = await request(app)
      .patch(`/api/v1/catalog/categories/${id}/activate`)
      .set('Authorization', `Bearer ${adminToken(tenantId)}`)
      .set('X-Correlation-ID', 'corr-auditoria-2');
    assert.equal(activar.status, 200);

    const otroTenant = await request(app)
      .patch(`/api/v1/catalog/categories/${id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken('tenant-ajeno-auditoria')}`);
    assert.equal(otroTenant.status, 404);
  } finally {
    container.setCategoryStatusUseCase.auditLogger = original;
  }

  assert.deepEqual(
    auditoria.map(({ decision, realizado_por, tenant_id, categoria_id, correlation_id }) => ({
      decision,
      realizado_por,
      tenant_id,
      categoria_id,
      correlation_id,
    })),
    [
      { decision: 'DESACTIVAR', realizado_por: 'admin-1', tenant_id: tenantId, categoria_id: id, correlation_id: 'corr-auditoria-1' },
      { decision: 'ACTIVAR', realizado_por: 'admin-1', tenant_id: tenantId, categoria_id: id, correlation_id: 'corr-auditoria-2' },
    ]
  );
});

// --- Reglas de categoría delegadas al Rules Service (US-03.1.1-M6) ---

test('POST /api/v1/catalog/categories delega en Rules con el tenant y el rol del token, y persiste lo normalizado', async () => {
  const tenantId = 'tenant-rules-delegacion';
  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .set('X-Correlation-ID', 'corr-rules-1')
    .send({ name: '  Pintura   Interior ', flujoOperativo: 'cotizacion_previa' });

  assert.equal(res.status, 201);
  assert.equal(res.body.category.name, 'Pintura Interior');
  assert.equal(res.body.category.flujoOperativo, 'COTIZACION_PREVIA');

  assert.equal(rules.requests.length, 1);
  const [call] = rules.requests;
  assert.equal(call.url, '/api/v1/rules/categories/evaluate');
  assert.equal(call.headers['x-tenant-id'], tenantId);
  assert.equal(call.headers['x-user-role'], 'ADMIN');
  assert.equal(call.headers['x-correlation-id'], 'corr-rules-1');
  assert.deepEqual(call.body, {
    categoryId: null,
    context: { operation: 'CREATE', name: '  Pintura   Interior ', flujoOperativo: 'cotizacion_previa' },
  });
});

test('POST /api/v1/catalog/categories responde 400 con las violaciones cuando Rules no aprueba, sin persistir', async () => {
  const tenantId = 'tenant-rules-rechazo';
  rules.respondWith(() => ({
    status: 200,
    body: {
      allowed: false,
      ruleSetVersion: 'fake-rules-v1',
      violations: [{ code: 'MANI-CAT-422N', field: 'name', message: 'el nombre debe tener entre 3 y 60 caracteres' }],
    },
  }));

  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'AB', flujoOperativo: 'TARIFA_ESTANDAR' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.violations[0].code, 'MANI-CAT-422N');

  rules.reset();
  const listRes = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);
  assert.equal(listRes.body.categories.length, 0);
});

test('POST /api/v1/catalog/categories responde 503 RULES_SERVICE_UNAVAILABLE si Rules falla (no cae a reglas locales)', async () => {
  rules.respondWith(() => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }));

  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('tenant-rules-caido')}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'RULES_SERVICE_UNAVAILABLE');
});

test('PUT /api/v1/catalog/categories/:id solo con description no consulta a Rules', async () => {
  const tenantId = 'tenant-rules-descripcion';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  rules.reset();

  const res = await request(app)
    .put(`/api/v1/catalog/categories/${createRes.body.category.id}`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ description: 'Solo cambia la descripción' });

  assert.equal(res.status, 200);
  assert.equal(rules.requests.length, 0);
});
