// SCRUM-1647: el saludo del inicio usa el nombre de la persona, no su correo. Contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: la de seguimientoSolicitud.pg.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fabricasPg } = require('../../helpers/pgPruebas');
const { ejecutarComo } = require('../../../src/application/context/contextoIdentidad');
const PgUsuarioRepository = require('../../../src/infrastructure/repositories/PgUsuarioRepository');
const PgProfileRepository = require('../../../src/infrastructure/repositories/PgProfileRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

const MIGRACION = fs.readFileSync(path.join(__dirname, '../../../db/migrations/0045_usuario_nombre.sql'), 'utf8');

async function sembrarTenant(pool) {
  const tenant = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Tenant 1647', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  return tenant;
}

test('SCRUM-1647: el perfil de un cliente guarda y devuelve su nombre; sin nombre cae al correo', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const usuarios = new PgUsuarioRepository({ pgPoolFactory: core });
  const perfiles = new PgProfileRepository({ pgPoolFactory: core });
  const tenant = await sembrarTenant(pool);

  const conNombre = uuid();
  const sinNombre = uuid();
  await ejecutarComo({ tenantId: tenant, userId: conNombre, role: 'CLIENT' }, () =>
    usuarios.create({ id: conNombre, tenantId: tenant, email: `ana-${conNombre}@t.test`, rol: 'CLIENT', estado: 'ACTIVE', fullName: '  Ana Pérez ' })
  );
  await ejecutarComo({ tenantId: tenant, userId: sinNombre, role: 'CLIENT' }, () =>
    usuarios.create({ id: sinNombre, tenantId: tenant, email: `sin-${sinNombre}@t.test`, rol: 'CLIENT', estado: 'ACTIVE' })
  );

  const ana = await ejecutarComo({ tenantId: tenant, userId: conNombre, role: 'CLIENT' }, () => perfiles.findByUserId(conNombre, tenant));
  assert.equal(ana.fullName, 'Ana Pérez');
  const anon = await ejecutarComo({ tenantId: tenant, userId: sinNombre, role: 'CLIENT' }, () => perfiles.findByUserId(sinNombre, tenant));
  assert.equal(anon.fullName, `sin-${sinNombre}@t.test`);
});

test('SCRUM-1647: repetir el registro sin nombre no borra el nombre guardado', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const usuarios = new PgUsuarioRepository({ pgPoolFactory: core });
  const tenant = await sembrarTenant(pool);
  const id = uuid();
  const base = { id, tenantId: tenant, email: `admin-${id}@t.test`, rol: 'CLIENT', estado: 'ACTIVE' };

  await ejecutarComo({ tenantId: tenant, userId: id, role: 'CLIENT' }, async () => {
    await usuarios.create({ ...base, fullName: 'Empresa Uno S.A.S.' });
    await usuarios.create(base);
  });

  const { rows } = await pool.query('SELECT nombre FROM usuario WHERE id = $1', [id]);
  assert.equal(rows[0].nombre, 'Empresa Uno S.A.S.');
});

test('SCRUM-1647: la 0045 rellena el nombre de las cuentas que ya existían y se puede repetir', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const tenant = await sembrarTenant(pool);
  const cliente = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $3, $4, 'CLIENTE', 'ACTIVO'), ($2, $3, $5, 'ALIADO', 'ACTIVO')", [
    cliente,
    aliado,
    tenant,
    `c-${cliente}@t.test`,
    `a-${aliado}@t.test`,
  ]);
  await pool.query("INSERT INTO cliente (tenant_id, usuario_id, tipo, razon_social) VALUES ($1, $2, 'PERSONA_JURIDICA', 'Constructora Sur')", [tenant, cliente]);
  await pool.query("INSERT INTO aliado (tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, 'PERSONA_NATURAL', 'Luis Gómez', 'PENDIENTE')", [tenant, aliado]);

  await pool.query(MIGRACION);
  await pool.query(MIGRACION);

  const { rows } = await pool.query('SELECT id, nombre FROM usuario WHERE id = ANY($1) ORDER BY email', [[cliente, aliado]]);
  assert.deepEqual(
    rows.map((f) => f.nombre),
    ['Luis Gómez', 'Constructora Sur']
  );
  const registro = await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version = '0045'");
  assert.equal(registro.rows[0].n, 1);
});
