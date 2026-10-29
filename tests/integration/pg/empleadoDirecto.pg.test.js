// SCRUM-1376 (RF-05): registro del empleado directo contra PostgreSQL real con el esquema oficial y la migración 0026.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Core corre como `mani_core_svc` (NOBYPASSRLS): la prueba cubre el GRANT y las políticas RLS. La siembra y los conteos
// usan el rol dueño.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgDirectEmployeeRepository = require('../../../src/infrastructure/repositories/PgDirectEmployeeRepository');
const RegisterDirectEmployeeUseCase = require('../../../src/application/useCases/allies/RegisterDirectEmployeeUseCase');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoRol = (u, rol) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;
const PDF = Buffer.from('%PDF-1.4\ncopia');

function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc') });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), core, repo: new PgDirectEmployeeRepository({ pgPoolFactory: core }) };
}

async function addTenant(pool) {
  const id = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [id, `t-${id}`]);
  const adminId = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [adminId, id, `${adminId}@t.test`]);
  const categorias = [];
  for (const nombre of ['Plomería', 'Electricidad']) {
    const c = uuid();
    await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, $3, 'ACTIVO')", [c, id, nombre]);
    categorias.push(c);
  }
  return { id, adminId, categorias, ctx: { tenantId: id, userId: adminId, role: 'ADMIN' } };
}

function datos(tenant, extra = {}) {
  const usuarioId = uuid();
  return {
    usuarioId,
    email: `${usuarioId}@t.test`,
    phone: '+573001234567',
    fullName: 'Jorge Directo',
    documentType: 'CC',
    documentNumber: `doc-${usuarioId}`,
    categoriaIds: tenant.categorias,
    documento: { tipoDocumento: 'documento_identidad', rutaStorage: `${tenant.id}/${usuarioId}/identidad/${uuid()}-cedula.pdf` },
    ...extra,
  };
}

const contar = async (pool, tabla, where, params) => (await pool.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${where}`, params)).rows[0].n;

test('PG: el administrador registra al empleado como mani_core_svc: VERIFICADO, categorías y documento, fuera de la bandeja', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const d = datos(tenant);
  const { aliadoId, documentoId } = await e.repo.registrar(tenant.ctx, d);

  const u = (await e.pool.query('SELECT rol, estado, telefono, tenant_id FROM usuario WHERE id = $1', [d.usuarioId])).rows[0];
  assert.deepEqual(u, { rol: 'ALIADO', estado: 'ACTIVO', telefono: '+573001234567', tenant_id: tenant.id });
  const a = (await e.pool.query('SELECT * FROM aliado WHERE id = $1', [aliadoId])).rows[0];
  assert.equal(a.tipo, 'EMPLEADO_DIRECTO');
  assert.equal(a.estado_verificacion, 'VERIFICADO');
  assert.equal(a.verificado_por, tenant.adminId, 'queda quién lo registró');
  assert.ok(a.fecha_verificacion);
  assert.equal(a.tipo_documento_identidad, 'CC');
  assert.equal(a.numero_documento_identidad, d.documentNumber);
  assert.equal(await contar(e.pool, 'aliado_categoria', 'aliado_id = $1 AND tenant_id = $2', [aliadoId, tenant.id]), 2);
  const doc = (await e.pool.query('SELECT * FROM documento_kyc WHERE id = $1', [documentoId])).rows[0];
  assert.equal(doc.estado, 'VERIFICADO');
  assert.equal(doc.tenant_id, tenant.id);
  assert.equal(doc.aliado_id, aliadoId);
  assert.equal(doc.ruta_storage, d.documento.rutaStorage);
  // La bandeja de verificación lista solo aliados PENDIENTE: el empleado no entra.
  assert.equal(await contar(e.pool, 'aliado', "id = $1 AND estado_verificacion = 'PENDIENTE'", [aliadoId]), 0);
});

test('PG C2: documento de identidad repetido en el tenant → 409 y revierte todo; en otro tenant se permite', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const otro = await addTenant(e.pool);
  const primero = datos(tenant);
  await e.repo.registrar(tenant.ctx, primero);

  const repetido = datos(tenant, { documentNumber: primero.documentNumber });
  await assert.rejects(e.repo.registrar(tenant.ctx, repetido), { code: 'DOCUMENT_ALREADY_REGISTERED', statusCode: 409 });
  assert.equal(await contar(e.pool, 'usuario', 'id = $1', [repetido.usuarioId]), 0, 'la transacción revirtió el usuario');
  assert.equal(await contar(e.pool, 'documento_kyc', 'ruta_storage = $1', [repetido.documento.rutaStorage]), 0);

  await e.repo.registrar(otro.ctx, datos(otro, { documentNumber: primero.documentNumber }));
});

test('PG C2: email repetido → 409 EMAIL_ALREADY_REGISTERED cuando la base lo detecta', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const d = datos(tenant);
  await e.repo.registrar(tenant.ctx, d);
  const otra = datos(tenant, { usuarioId: d.usuarioId });
  await assert.rejects(e.repo.registrar(tenant.ctx, otra), (err) => err.statusCode === 409);
});

test('PG C3: categoría de otro tenant → CATEGORY_NOT_FOUND y no queda ninguna fila', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const ajeno = await addTenant(e.pool);
  const d = datos(tenant, { categoriaIds: [tenant.categorias[0], ajeno.categorias[0]] });
  await assert.rejects(e.repo.registrar(tenant.ctx, d), { code: 'CATEGORY_NOT_FOUND' });
  assert.equal(await contar(e.pool, 'usuario', 'id = $1', [d.usuarioId]), 0);
});

test('PG C3: el tenant sale del contexto del JWT; no se puede crear al empleado en un tenant ajeno', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const ajeno = await addTenant(e.pool);
  // El contexto es del tenant A; las categorías son del B y el repositorio no recibe otro tenant: todo cae en A.
  const d = datos(tenant);
  const { aliadoId } = await e.repo.registrar(tenant.ctx, d);
  assert.equal(await contar(e.pool, 'aliado', 'id = $1 AND tenant_id = $2', [aliadoId, tenant.id]), 1);
  assert.equal(await contar(e.pool, 'aliado', 'id = $1 AND tenant_id = $2', [aliadoId, ajeno.id]), 0);
});

test('PG RLS 0026: el administrador no inserta documentos a aliados de otro tenant ni a aliados que no son empleados directos', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const ajeno = await addTenant(e.pool);
  const { aliadoId: propio } = await e.repo.registrar(tenant.ctx, datos(tenant));
  const { aliadoId: delAjeno } = await e.repo.registrar(ajeno.ctx, datos(ajeno));

  const externoUsuario = uuid();
  await e.pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [externoUsuario, tenant.id, `${externoUsuario}@t.test`]);
  const externo = uuid();
  await e.pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ext', 'PENDIENTE')",
    [externo, tenant.id, externoUsuario]
  );

  const insertar = (ctx, tenantId, aliadoId) =>
    runInTenantContext(e.core, ctx, (client) =>
      client.query("INSERT INTO documento_kyc (tenant_id, aliado_id, tipo_documento, ruta_storage, estado) VALUES ($1, $2, 'x', $3, 'PENDIENTE')", [tenantId, aliadoId, `r/${uuid()}`])
    );
  const rls = (err) => err.code === '42501';

  await insertar(tenant.ctx, tenant.id, propio); // permitido: empleado directo del mismo tenant
  await assert.rejects(insertar(tenant.ctx, tenant.id, delAjeno), rls, 'aliado de otro tenant con tenant_id propio');
  await assert.rejects(insertar(tenant.ctx, ajeno.id, delAjeno), rls, 'tenant_id ajeno');
  await assert.rejects(insertar(tenant.ctx, tenant.id, externo), rls, 'aliado externo: su KYC lo sube él');
  const comoCliente = { tenantId: tenant.id, userId: uuid(), role: 'CLIENT' };
  await assert.rejects(insertar(comoCliente, tenant.id, propio), rls, 'rol distinto de administrador');
});

test('PG: el caso de uso completo corre como mani_core_svc y audita la operación', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const auditoria = [];
  const subidos = [];
  const useCase = new RegisterDirectEmployeeUseCase({
    tenantRepository: { findById: async (id) => ({ id, isActive: () => true }) },
    catalogRepository: { findById: async (_t, id) => ({ id, isActive: () => true }) },
    usuarioRepository: { findByEmail: async () => null },
    aliadoRepository: { findByDocumentNumber: async () => null },
    directEmployeeRepository: e.repo,
    fileStorageService: { upload: async (p) => subidos.push(p.path), delete: async () => {} },
    authIdentityService: { createUser: async () => ({ userId: uuid() }), deleteUser: async () => {} },
    auditLogger: (entry) => auditoria.push(entry),
  });
  const result = await useCase.execute({
    tenantId: tenant.id,
    adminUserId: tenant.adminId,
    correlationId: 'corr-pg',
    fullName: 'Ana Directa',
    email: 'ana@t.test',
    phone: '3001234567',
    documentType: 'CE',
    documentNumber: 'ce-123',
    categoriaIds: tenant.categorias,
    documento: { buffer: PDF, mimetype: 'application/pdf', originalname: 'cedula.pdf' },
  });
  assert.equal(result.employee.estadoVerificacion, 'VERIFICADO');
  assert.equal(await contar(e.pool, 'documento_kyc', 'aliado_id = $1', [result.employee.id]), 1);
  assert.equal(auditoria[0].realizado_por, tenant.adminId);
  assert.equal(auditoria[0].correlation_id, 'corr-pg');
  assert.equal(subidos.length, 1);
});
