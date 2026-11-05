// SCRUM-1468 (TEC-21): los repositorios que antes usaban supabase-js con la clave service_role (que salta RLS) ahora
// van por `pg` como mani_core_svc. Estas pruebas los ejercitan contra PostgreSQL real con ese rol y sus políticas:
// el registro completo (con su compensación), la bandeja de verificación del admin, el perfil, el catálogo, clientes y
// sedes, ausencias y documentos legales, y que ninguno cruza de tenant.
//
// Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fabricasPg } = require('../../helpers/pgPruebas');
const { ejecutarComo } = require('../../../src/application/context/contextoIdentidad');
const { ConflictError, DomainError } = require('../../../src/domain/errors/DomainError');
const AllyAbsence = require('../../../src/domain/entities/AllyAbsence');
const PgTenantRepository = require('../../../src/infrastructure/repositories/PgTenantRepository');
const PgUsuarioRepository = require('../../../src/infrastructure/repositories/PgUsuarioRepository');
const PgAliadoRepository = require('../../../src/infrastructure/repositories/PgAliadoRepository');
const PgAliadoCategoriaRepository = require('../../../src/infrastructure/repositories/PgAliadoCategoriaRepository');
const PgDocumentoKycRepository = require('../../../src/infrastructure/repositories/PgDocumentoKycRepository');
const PgUserConsentRepository = require('../../../src/infrastructure/repositories/PgUserConsentRepository');
const PgLegalDocumentRepository = require('../../../src/infrastructure/repositories/PgLegalDocumentRepository');
const PgProfileRepository = require('../../../src/infrastructure/repositories/PgProfileRepository');
const PgCatalogRepository = require('../../../src/infrastructure/repositories/PgCatalogRepository');
const PgClienteRepository = require('../../../src/infrastructure/repositories/PgClienteRepository');
const PgSitioRepository = require('../../../src/infrastructure/repositories/PgSitioRepository');
const PgAliadoAusenciaRepository = require('../../../src/infrastructure/repositories/PgAliadoAusenciaRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

function repositorios(core) {
  const pgPoolFactory = core;
  return {
    tenants: new PgTenantRepository({ pgPoolFactory }),
    usuarios: new PgUsuarioRepository({ pgPoolFactory }),
    aliados: new PgAliadoRepository({ pgPoolFactory }),
    categoriasAliado: new PgAliadoCategoriaRepository({ pgPoolFactory }),
    kyc: new PgDocumentoKycRepository({ pgPoolFactory }),
    consentimientos: new PgUserConsentRepository({ pgPoolFactory }),
    legales: new PgLegalDocumentRepository({ pgPoolFactory }),
    perfiles: new PgProfileRepository({ pgPoolFactory }),
    catalogo: new PgCatalogRepository({ pgPoolFactory }),
    clientes: new PgClienteRepository({ pgPoolFactory }),
    sitios: new PgSitioRepository({ pgPoolFactory }),
    ausencias: new PgAliadoAusenciaRepository({ pgPoolFactory }),
  };
}

/** Un tenant con su admin, una categoría activa, un documento legal propio y uno global. */
async function sembrarTenant(pool) {
  const s = { tenant: uuid(), slug: `t-${uuid()}`, admin: uuid(), categoria: uuid(), legalTenant: uuid(), legalGlobal: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Tenant 1468', $2, 'ACTIVO')", [s.tenant, s.slug]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [
    s.admin,
    s.tenant,
    `${s.admin}@t.test`,
  ]);
  await pool.query(
    "INSERT INTO categoria_servicio (id, tenant_id, nombre, estado, flujo_operativo) VALUES ($1, $2, $3, 'ACTIVO', 'COTIZACION_PREVIA')",
    [s.categoria, s.tenant, `Electricidad ${s.tenant}`]
  );
  await pool.query(
    "INSERT INTO documento_legal (id, tenant_id, tipo, version, contenido, is_active) VALUES ($1, $2, 'TERMINOS', '1', 'Del tenant', true), ($3, NULL, 'PRIVACIDAD', '1', 'Global', true)",
    [s.legalTenant, s.tenant, s.legalGlobal]
  );
  return s;
}

/** Registro de un aliado como lo hace RegisterAllyNaturalPersonUseCase: como el usuario recién creado en Auth. */
async function registrarAliado(r, s) {
  const userId = uuid();
  const email = `Ana.${userId}@T.test`;
  return ejecutarComo({ tenantId: s.tenant, userId, role: 'ALLY' }, async () => {
    await r.usuarios.create({ id: userId, tenantId: s.tenant, email, rol: 'ALLY', estado: 'ACTIVE', phone: '3001234567' });
    const aliado = await r.aliados.create({
      tenantId: s.tenant,
      usuarioId: userId,
      tipo: 'PERSONA_NATURAL',
      nombreRazonSocial: 'Ana Pérez',
      estadoVerificacion: 'PENDING',
      documentType: 'CC',
      documentNumber: `doc-${userId}`,
    });
    await r.categoriasAliado.create({ tenantId: s.tenant, aliadoId: aliado.id, categoriaId: s.categoria });
    const documentos = await r.kyc.createMany(s.tenant, aliado.id, [
      { tipoDocumento: 'CEDULA', rutaStorage: `${s.tenant}/${userId}/cedula.pdf` },
      { tipoDocumento: 'RUT', rutaStorage: `${s.tenant}/${userId}/rut.pdf` },
    ]);
    const consentimiento = await r.consentimientos.create({
      tenantId: s.tenant,
      usuarioId: userId,
      documentoLegalId: s.legalTenant,
      ipAddress: '10.0.0.1',
      userAgent: 'pruebas',
    });
    return { userId, email, aliado, documentos, consentimiento };
  });
}

const contar = async (pool, tabla, columna, valor) =>
  Number((await pool.query(`SELECT count(*) FROM ${tabla} WHERE ${columna} = $1`, [valor])).rows[0].count);

test('registro de aliado como mani_core_svc: crea todo, y la compensación lo borra todo', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);

  const reg = await registrarAliado(r, s);
  assert.equal(reg.aliado.estado_verificacion, 'PENDIENTE');
  assert.equal(reg.documentos.length, 2);
  assert.equal(reg.consentimiento.usuarioId, reg.userId);

  await ejecutarComo({ tenantId: s.tenant, userId: reg.userId, role: 'ALLY' }, async () => {
    assert.equal(await r.consentimientos.hasConsented(reg.userId, s.legalTenant), true);
    // Un reintento conserva el consentimiento original como evidencia.
    const repetido = await r.consentimientos.create({
      tenantId: s.tenant,
      usuarioId: reg.userId,
      documentoLegalId: s.legalTenant,
      ipAddress: '10.9.9.9',
      userAgent: 'otro',
    });
    assert.equal(repetido.id, reg.consentimiento.id);
    assert.equal(repetido.ipAddress, '10.0.0.1');

    // Compensación de un registro fallido, en el mismo orden que el caso de uso.
    await r.consentimientos.deleteByUsuarioId(s.tenant, reg.userId);
    await r.kyc.deleteByAliadoId(s.tenant, reg.aliado.id);
    await r.categoriasAliado.deleteByAliadoId(s.tenant, reg.aliado.id);
    await r.aliados.deleteByUsuarioId(s.tenant, reg.userId);
    await r.usuarios.deleteById(s.tenant, reg.userId);
  });

  assert.equal(await contar(pool, 'consentimiento_usuario', 'usuario_id', reg.userId), 0);
  assert.equal(await contar(pool, 'documento_kyc', 'aliado_id', reg.aliado.id), 0);
  assert.equal(await contar(pool, 'aliado_categoria', 'aliado_id', reg.aliado.id), 0);
  assert.equal(await contar(pool, 'aliado', 'id', reg.aliado.id), 0);
  assert.equal(await contar(pool, 'usuario', 'id', reg.userId), 0);
});

test('el upsert de usuario no borra el teléfono si un reintento no lo trae, y el email no distingue mayúsculas', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const reg = await registrarAliado(r, s);

  await r.usuarios.create({ id: reg.userId, tenantId: s.tenant, email: reg.email, rol: 'ALLY', estado: 'ACTIVE' });
  const usuario = await r.usuarios.findByEmail(s.tenant, reg.email.toLowerCase());
  assert.equal(usuario.id, reg.userId);
  assert.equal((await r.usuarios.findById(s.tenant, reg.userId)).telefono, '3001234567');
});

test('sin la identidad del aliado, la base no deja dar de alta sus documentos KYC', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const reg = await registrarAliado(r, s);

  // Fuera de una operación con identidad, app.set_context no lleva usuario y la política documento_kyc_alta rechaza.
  await assert.rejects(
    r.kyc.createMany(s.tenant, reg.aliado.id, [{ tipoDocumento: 'CEDULA', rutaStorage: 'x/y.pdf' }]),
    (err) => err instanceof DomainError && err.statusCode === 500 && err.cause?.code === '42501'
  );
  assert.equal(await contar(pool, 'documento_kyc', 'aliado_id', reg.aliado.id), 2);
});

test('bandeja de verificación como admin del tenant: ve los KYC, aprueba y deja quién resolvió', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const otro = await sembrarTenant(pool);
  const reg = await registrarAliado(r, s);

  await ejecutarComo({ tenantId: s.tenant, userId: s.admin, role: 'ADMIN' }, async () => {
    const pendientes = await r.aliados.findByTenant(s.tenant, { estadoVerificacion: 'PENDING' });
    assert.deepEqual(pendientes.map((a) => a.id), [reg.aliado.id]);
    assert.equal((await r.kyc.findByAliadoId(s.tenant, reg.aliado.id)).length, 2);
    assert.deepEqual((await r.categoriasAliado.findByAliadoId(s.tenant, reg.aliado.id)), [s.categoria]);

    const aprobado = await r.aliados.updateVerificationStatus(s.tenant, reg.aliado.id, {
      estadoVerificacion: 'VERIFIED',
      verificadoPor: s.admin,
    });
    assert.equal(aprobado.verificado_por, s.admin, 'con mani_core_svc la aprobación ya no responde 409 por falta de contexto');
    assert.equal((await r.kyc.updateStatusByAliadoId(s.tenant, reg.aliado.id, 'VERIFICADO')).length, 2);
  });

  // El admin de otro tenant no ve los documentos ni puede resolver, aunque pida el tenant ajeno.
  await ejecutarComo({ tenantId: otro.tenant, userId: otro.admin, role: 'ADMIN' }, async () => {
    assert.deepEqual(await r.kyc.findByAliadoId(s.tenant, reg.aliado.id), []);
    assert.equal(await r.aliados.findById(otro.tenant, reg.aliado.id), null);
  });
});

test('perfil propio: lee el del aliado con su nombre y estado, lo actualiza y no cruza de tenant', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const otro = await sembrarTenant(pool);
  const reg = await registrarAliado(r, s);

  const perfil = await r.perfiles.findByUserId(reg.userId, s.tenant);
  assert.equal(perfil.role, 'ALLY');
  assert.equal(perfil.fullName, 'Ana Pérez');
  assert.equal(perfil.status, 'PENDING');

  const actualizado = await r.perfiles.updateOwnProfile(reg.userId, s.tenant, { phone: '3110000000', fullName: 'Ana P.' });
  assert.equal(actualizado.phone, '3110000000');
  assert.equal(actualizado.fullName, 'Ana P.');
  assert.equal((await r.perfiles.findByUserId(reg.userId, s.tenant)).fullName, 'Ana P.');

  assert.equal(await r.perfiles.findByUserId(reg.userId, otro.tenant), null);
  assert.equal(await r.perfiles.updateOwnProfile(reg.userId, otro.tenant, { phone: '1' }), null);
  assert.equal(await r.perfiles.findByUserId(reg.userId, null), null);
});

test('catálogo del tenant: alta, nombre repetido, conteo de aliados, edición y desactivación', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const otro = await sembrarTenant(pool);
  await registrarAliado(r, s);

  const creada = await r.catalogo.create(s.tenant, { name: 'Pintura', flujoOperativo: 'TARIFA_ESTANDAR' });
  assert.equal(creada.alliesCount, 0);
  await assert.rejects(r.catalogo.create(s.tenant, { name: 'Pintura', flujoOperativo: 'TARIFA_ESTANDAR' }), ConflictError);

  const conAliado = await r.catalogo.findById(s.tenant, s.categoria);
  assert.equal(conAliado.alliesCount, 1);
  assert.equal(await r.catalogo.findById(otro.tenant, s.categoria), null);

  assert.equal((await r.catalogo.update(s.tenant, creada.id, { name: 'Pintura y acabados' })).name, 'Pintura y acabados');
  assert.equal((await r.catalogo.setActive(s.tenant, creada.id, false)).active, false);
  assert.deepEqual(
    (await r.catalogo.findActiveByTenant(s.tenant)).map((c) => c.id),
    [s.categoria],
    'la desactivada no aparece entre las activas'
  );
  assert.equal((await r.catalogo.findAllByTenant(s.tenant)).length, 2);
  assert.equal((await r.catalogo.findAllByTenant(s.tenant, { onlyActive: true })).length, 1);

  assert.deepEqual(await r.catalogo.findAllCategories(), [], 'sin identidad no hay catálogo que listar');
  await ejecutarComo({ tenantId: s.tenant, userId: s.admin, role: 'ADMIN' }, async () => {
    assert.equal((await r.catalogo.findAllCategories()).length, 2);
  });
});

test('cliente y sede del registro: alta idempotente, búsqueda por NIT y borrado', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const zona = uuid();
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  const usuarioId = uuid();
  await r.usuarios.create({ id: usuarioId, tenantId: s.tenant, email: `${usuarioId}@t.test`, rol: 'CLIENT', estado: 'ACTIVE' });

  const nit = `900${Date.now()}`;
  const cliente = await r.clientes.create({ tenantId: s.tenant, usuarioId, tipo: 'PERSONA_JURIDICA', razonSocial: 'ACME', nit });
  const otraVez = await r.clientes.create({ tenantId: s.tenant, usuarioId, tipo: 'PERSONA_JURIDICA', telefono: '6011234567' });
  assert.equal(otraVez.id, cliente.id);
  assert.equal(otraVez.razon_social, 'ACME', 'un dato que no llega conserva el guardado');
  assert.equal((await r.clientes.findByNit(s.tenant, nit)).id, cliente.id);

  assert.ok(await r.sitios.findFirstActiveZonaId());
  const sitio = await r.sitios.create({ tenantId: s.tenant, clienteId: cliente.id, zonaId: zona, direccion: 'Calle 1 # 2-3' });
  assert.equal(sitio.cliente_id, cliente.id);

  await r.sitios.deleteByClienteId(s.tenant, cliente.id);
  await r.clientes.deleteByUsuarioId(s.tenant, usuarioId);
  assert.equal(await contar(pool, 'sitio', 'id', sitio.id), 0);
  assert.equal(await contar(pool, 'cliente', 'id', cliente.id), 0);
});

test('ausencias del aliado: alta, solapamiento 409, edición y borrado dentro de su tenant', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);
  const otro = await sembrarTenant(pool);
  const reg = await registrarAliado(r, s);
  const dia = (n) => new Date(Date.now() + n * 86400000);
  const ausencia = (inicio, fin) =>
    new AllyAbsence({ tenantId: s.tenant, aliadoId: reg.aliado.id, startsAt: dia(inicio), endsAt: dia(fin), reason: 'VACACIONES' });

  const creada = await r.ausencias.create(ausencia(1, 3));
  await assert.rejects(r.ausencias.create(ausencia(2, 4)), (err) => err.code === 'MANI-AUS-409');
  assert.equal((await r.ausencias.findOverlapping(s.tenant, reg.aliado.id, dia(2), dia(4))).length, 1);
  assert.equal((await r.ausencias.findOverlapping(s.tenant, reg.aliado.id, dia(2), dia(4), creada.id)).length, 0);

  const movida = await r.ausencias.update(
    new AllyAbsence({ ...ausencia(5, 6), id: creada.id, note: 'Viaje' })
  );
  assert.equal(movida.note, 'Viaje');
  assert.equal((await r.ausencias.findByAliadoId(s.tenant, reg.aliado.id)).length, 1);
  assert.equal(await r.ausencias.findById(otro.tenant, reg.aliado.id, creada.id), null);
  assert.equal(await r.ausencias.delete(otro.tenant, reg.aliado.id, creada.id), false);
  assert.equal(await r.ausencias.delete(s.tenant, reg.aliado.id, creada.id), true);
});

test('directorio de tenants y documentos legales: globales sin contexto, los del tenant solo con su identidad', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const r = repositorios(core);
  const s = await sembrarTenant(pool);

  assert.equal((await r.tenants.findBySlug(s.slug)).id, s.tenant);
  assert.equal((await r.tenants.findById(s.tenant)).status, 'ACTIVE');
  assert.equal(await r.tenants.findById('no-es-uuid'), null);
  assert.ok((await r.tenants.findAll()).some((tenant) => tenant.id === s.tenant));

  const delTenant = await r.legales.getActiveDocuments(s.tenant);
  assert.ok(delTenant.some((d) => d.id === s.legalTenant));
  assert.ok(delTenant.some((d) => d.id === s.legalGlobal));
  const soloGlobales = await r.legales.getActiveDocuments(null);
  assert.ok(soloGlobales.some((d) => d.id === s.legalGlobal));
  assert.ok(!soloGlobales.some((d) => d.id === s.legalTenant));

  assert.equal(await r.legales.findById(s.legalTenant), null, 'sin identidad, un documento de tenant no se ve');
  await ejecutarComo({ tenantId: s.tenant, userId: s.admin, role: 'ADMIN' }, async () => {
    assert.equal((await r.legales.findById(s.legalTenant)).id, s.legalTenant);
  });
});
