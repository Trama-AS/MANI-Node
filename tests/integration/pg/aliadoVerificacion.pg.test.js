// CA-5 de US-02.1.3 (TEC-20): quién resolvió la verificación queda en aliado.verificado_por, leído desde PostgreSQL.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const TransactionalAliadoRepository = require('../../../src/infrastructure/repositories/TransactionalAliadoRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function seed(pool) {
  const tenant = uuid();
  const admin = uuid();
  const usuarioAliado = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [
    admin,
    tenant,
    `${admin}@t.test`,
  ]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [
    usuarioAliado,
    tenant,
    `${usuarioAliado}@t.test`,
  ]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'PENDIENTE')",
    [aliado, tenant, usuarioAliado]
  );
  return { tenant, admin, aliado };
}

async function readVerification(pool, aliado) {
  const { rows } = await pool.query(
    'SELECT estado_verificacion, verificado_por, motivo_rechazo, fecha_verificacion FROM aliado WHERE id = $1',
    [aliado]
  );
  return rows[0];
}

test('PG CA-5: aprobar deja verificado_por y fecha en la base; una segunda decisión no lo sobrescribe', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new TransactionalAliadoRepository({ pgPoolFactory: factory, delegate: {} });
  const s = await seed(pool);

  const fecha = new Date().toISOString();
  const row = await repo.updateVerificationStatus(s.tenant, s.aliado, {
    estadoVerificacion: 'VERIFIED',
    fechaVerificacion: fecha,
    verificadoPor: s.admin,
  });
  assert.equal(row.verificado_por, s.admin);

  const stored = await readVerification(pool, s.aliado);
  assert.equal(stored.estado_verificacion, 'VERIFICADO');
  assert.equal(stored.verificado_por, s.admin);
  assert.equal(stored.fecha_verificacion.toISOString(), fecha);

  const otroAdmin = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [
    otroAdmin,
    s.tenant,
    `${otroAdmin}@t.test`,
  ]);
  const second = await repo.updateVerificationStatus(s.tenant, s.aliado, {
    estadoVerificacion: 'REJECTED',
    motivoRechazo: 'Decision tardia de otro admin',
    verificadoPor: otroAdmin,
  });
  assert.equal(second, null, 'ya no está PENDIENTE: el caso de uso responde 409');
  assert.equal((await readVerification(pool, s.aliado)).verificado_por, s.admin);
});

test('PG CA-5: rechazar guarda motivo y verificado_por; otro tenant no puede resolver', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new TransactionalAliadoRepository({ pgPoolFactory: factory, delegate: {} });
  const s = await seed(pool);
  const otro = await seed(pool);

  const cruzado = await repo.updateVerificationStatus(otro.tenant, s.aliado, {
    estadoVerificacion: 'VERIFIED',
    verificadoPor: otro.admin,
  });
  assert.equal(cruzado, null);
  assert.equal((await readVerification(pool, s.aliado)).estado_verificacion, 'PENDIENTE');

  await repo.updateVerificationStatus(s.tenant, s.aliado, {
    estadoVerificacion: 'REJECTED',
    motivoRechazo: 'Documento ilegible',
    verificadoPor: s.admin,
  });
  const stored = await readVerification(pool, s.aliado);
  assert.equal(stored.estado_verificacion, 'RECHAZADO');
  assert.equal(stored.motivo_rechazo, 'Documento ilegible');
  assert.equal(stored.verificado_por, s.admin);
});
