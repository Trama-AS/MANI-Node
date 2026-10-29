// Verifica el registro de eventos durante la ejecución (SCRUM-869) contra PostgreSQL real con el esquema oficial,
// incluida la migración 0014. Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15
// vacío y scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgServiceEventRepository = require('../../../src/infrastructure/repositories/PgServiceEventRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

// Tenant con cliente, dos aliados y una solicitud EN_EJECUCION del primero.
async function seed(pool, estado = 'EN_EJECUCION') {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), sitio: uuid(), solicitud: uuid(), cliente: uuid(), aliado: uuid(), aliado2: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  s.usuarioCliente = await addUsuario(pool, s.tenant, 'CLIENTE');
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  for (const [aliado, clave] of [[s.aliado, 'usuarioAliado'], [s.aliado2, 'usuarioAliado2']]) {
    s[clave] = await addUsuario(pool, s.tenant, 'ALIADO');
    await pool.query(
      "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', 'VERIFICADO')",
      [aliado, s.tenant, s[clave]]
    );
  }
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query(
    'INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado, estado]
  );
  return s;
}

test('PG eventos: secuencia ordenada con autor y evidencia, idempotente por clave y aislada', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceEventRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };
  const clave = uuid();
  const datos = (extra) => ({ solicitudId: s.solicitud, tipo: 'EJECUCION_OBSERVACION', observacion: 'Llegué', evidenciaRuta: null, claveIdempotencia: null, ...extra });

  const a = await repo.registrar(aliado, datos({ tipo: 'EJECUCION_AVANCE', observacion: 'Cambié la tubería', evidenciaRuta: 'r/a.png', claveIdempotencia: clave }));
  assert.equal(a.creado, true);
  assert.equal(a.evento.tieneEvidencia, true);
  assert.equal(a.evento.autor.id, s.usuarioAliado);

  // Un reintento con la misma clave no duplica.
  const reintento = await repo.registrar(aliado, datos({ tipo: 'EJECUCION_AVANCE', observacion: 'Cambié la tubería', evidenciaRuta: 'r/b.png', claveIdempotencia: clave }));
  assert.equal(reintento.creado, false);
  assert.equal(reintento.evento.id, a.evento.id);
  await repo.registrar(aliado, datos({ tipo: 'EJECUCION_NOVEDAD', observacion: 'Fuga adicional' }));

  // C3: otro aliado no registra; C1: el cliente ve la secuencia en orden.
  await assert.rejects(repo.registrar({ ...aliado, userId: s.usuarioAliado2 }, datos()), { code: 'MANI-EVT-403A' });
  const lista = await repo.listar({ tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' }, s.solicitud);
  assert.deepEqual(lista.map((e) => e.tipo), ['EJECUCION_AVANCE', 'EJECUCION_NOVEDAD']);
  assert.ok(lista[0].registradoEn <= lista[1].registradoEn);
  assert.ok(lista.every((e) => e.autor.rol === 'ALIADO'));
  const guardada = await pool.query('SELECT evidencia_ruta FROM evento_servicio WHERE id = $1', [a.evento.id]);
  assert.equal(guardada.rows[0].evidencia_ruta, 'r/a.png');

  await assert.rejects(repo.listar({ ...aliado, userId: s.usuarioAliado2 }, s.solicitud), { code: 'MANI-EVT-404' });
  const otro = await seed(pool);
  await assert.rejects(repo.listar({ tenantId: otro.tenant, userId: otro.usuarioCliente, role: 'CLIENT' }, s.solicitud), { code: 'MANI-EVT-404' });
});

test('PG eventos: fuera de la ejecución no se registra (C2)', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceEventRepository({ pgPoolFactory: factory });
  const s = await seed(pool, 'FINALIZADA');
  await assert.rejects(
    repo.registrar(
      { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' },
      { solicitudId: s.solicitud, tipo: 'EJECUCION_OBSERVACION', observacion: 'Tarde', evidenciaRuta: null, claveIdempotencia: null }
    ),
    { code: 'MANI-EVT-409E' }
  );
  const n = await pool.query('SELECT count(*)::int AS n FROM evento_servicio WHERE solicitud_id = $1', [s.solicitud]);
  assert.equal(n.rows[0].n, 0);
});

// SCRUM-873: marca de inicio o fin con una hora dada, como la deja SCRUM-868.
async function marcar(pool, s, tipo, hora) {
  await pool.query(
    'INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, timestamp) VALUES ($1, $2, $3, $4, $5)',
    [s.tenant, s.solicitud, s.usuarioAliado, tipo, hora]
  );
}

test('PG eventos sin conexión: la hora de captura es la oficial y debe caer dentro de la ejecución (SCRUM-873)', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceEventRepository({ pgPoolFactory: factory });
  const minutos = (n) => new Date(Date.now() + n * 60 * 1000);
  const datos = (s, extra) => ({ solicitudId: s.solicitud, tipo: 'EJECUCION_AVANCE', observacion: 'Sin señal', evidenciaRuta: null, claveIdempotencia: null, ...extra });

  // En ejecución: se guarda la hora de captura y la bitácora se ordena por ella, no por la llegada.
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };
  await marcar(pool, s, 'INICIO_EJECUCION', minutos(-120));
  await repo.registrar(aliado, datos(s, { observacion: 'En línea' }));
  const tomado = minutos(-90);
  const offline = await repo.registrar(aliado, datos(s, { observacion: 'Tomado sin señal', ocurridoEn: tomado, claveIdempotencia: uuid() }));
  assert.equal(offline.evento.ocurridoEn.getTime(), tomado.getTime());
  assert.ok(offline.evento.registradoEn > tomado);
  const lista = await repo.listar({ tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' }, s.solicitud);
  assert.deepEqual(lista.map((e) => e.descripcion ?? e.tipo).slice(-2), ['Tomado sin señal', 'En línea']);
  // Los eventos sin hora de captura muestran la de registro.
  assert.ok(lista.every((e) => e.ocurridoEn instanceof Date));

  // Antes del inicio o en el futuro no entra.
  await assert.rejects(repo.registrar(aliado, datos(s, { ocurridoEn: minutos(-180) })), { code: 'MANI-EVT-409T' });
  await assert.rejects(repo.registrar(aliado, datos(s, { ocurridoEn: minutos(30) })), { code: 'MANI-EVT-400F' });
  // Dentro de la tolerancia del reloj del teléfono sí entra.
  await repo.registrar(aliado, datos(s, { ocurridoEn: minutos(2) }));

  // Finalizado: entra lo tomado entre inicio y fin aunque llegue después; lo tomado tras el fin no.
  const f = await seed(pool, 'FINALIZADA');
  const aliadoF = { tenantId: f.tenant, userId: f.usuarioAliado, role: 'ALLY' };
  await marcar(pool, f, 'INICIO_EJECUCION', minutos(-120));
  await marcar(pool, f, 'FIN_EJECUCION', minutos(-60));
  const tarde = await repo.registrar(aliadoF, datos(f, { ocurridoEn: minutos(-70), claveIdempotencia: uuid() }));
  assert.equal(tarde.creado, true);
  await assert.rejects(repo.registrar(aliadoF, datos(f, { ocurridoEn: minutos(-30) })), { code: 'MANI-EVT-409T' });
  // Sin hora de captura sigue la regla de la 869: solo en ejecución.
  await assert.rejects(repo.registrar(aliadoF, datos(f)), { code: 'MANI-EVT-409E' });

  // Cancelado: nunca, aunque la hora caiga dentro de lo que se alcanzó a ejecutar.
  const c = await seed(pool, 'CANCELADA');
  await marcar(pool, c, 'INICIO_EJECUCION', minutos(-120));
  await assert.rejects(
    repo.registrar({ tenantId: c.tenant, userId: c.usuarioAliado, role: 'ALLY' }, datos(c, { ocurridoEn: minutos(-100) })),
    { code: 'MANI-EVT-409E' }
  );
  const n = await pool.query(
    "SELECT count(*)::int AS n FROM evento_servicio WHERE solicitud_id = ANY($1) AND tipo_evento LIKE 'EJECUCION_%'",
    [[f.solicitud, c.solicitud]]
  );
  assert.equal(n.rows[0].n, 1);
});
