// HU-M04-07 (SCRUM-1396): catálogo geográfico y límites leídos por `pg`, contra PostgreSQL real con la migración 0036.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Core corre como `mani_core_svc` (NOBYPASSRLS): la prueba cubre también el GRANT y la política de lectura de la 0036.
// La siembra usa el rol dueño, porque la carga de geometrías la opera DevOps con rol administrativo.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgZoneRepository = require('../../../src/infrastructure/repositories/PgZoneRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoRol = (u, rol) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;

// Polígono mínimo válido y cerrado, en orden longitud-latitud (RFC 7946).
const POLIGONO = {
  type: 'Polygon',
  coordinates: [
    [
      [-74.05, 4.65],
      [-74.04, 4.65],
      [-74.04, 4.66],
      [-74.05, 4.66],
      [-74.05, 4.65],
    ],
  ],
};

function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc') });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), repo: new PgZoneRepository({ pgPoolFactory: core }) };
}

async function addZona(pool, { nivel, nombre, padre = null, estado = 'ACTIVO' }) {
  const id = uuid();
  await pool.query('INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, $2, $3, $4, $5)', [
    id,
    nivel,
    nombre,
    padre,
    estado,
  ]);
  return id;
}

async function addGeometria(pool, zonaId, geometria = POLIGONO) {
  await pool.query(
    `INSERT INTO geometria_territorial (zona_id, geometria, fuente, codigo_fuente, licencia, atribucion, fuente_fecha)
     VALUES ($1, $2::jsonb, 'UAECD', '02', 'CC BY 4.0', 'Límites: UAECD (CC BY 4.0)', DATE '2025-11-30')`,
    [zonaId, JSON.stringify(geometria)]
  );
}

test('PgZoneRepository: catálogo y límites (SCRUM-1396)', opts, async (t) => {
  const { pool, repo } = entorno(t);

  await t.test('findGeometriesByZoneIds devuelve el GeoJSON con su procedencia', async () => {
    const ciudad = await addZona(pool, { nivel: 'CIUDAD', nombre: `Ciudad ${uuid()}` });
    const zona = await addZona(pool, { nivel: 'LOCALIDAD', nombre: `Localidad ${uuid()}`, padre: ciudad });
    await addGeometria(pool, zona);

    const [g] = await repo.findGeometriesByZoneIds([zona]);

    assert.equal(g.zoneId, zona);
    assert.deepEqual(g.geometry, POLIGONO);
    // La licencia obliga a acreditar la fuente en la interfaz, así que la
    // atribución tiene que viajar con el dato y no quedarse en la base.
    assert.equal(g.attribution, 'Límites: UAECD (CC BY 4.0)');
    assert.equal(g.licence, 'CC BY 4.0');
    assert.equal(g.sourceCode, '02');
    assert.ok(g.updatedAt);
  });

  await t.test('una zona sin límite cargado se omite, no se inventa', async () => {
    const ciudad = await addZona(pool, { nivel: 'CIUDAD', nombre: `Ciudad ${uuid()}` });
    const conLimite = await addZona(pool, { nivel: 'LOCALIDAD', nombre: `Con ${uuid()}`, padre: ciudad });
    const sinLimite = await addZona(pool, { nivel: 'LOCALIDAD', nombre: `Sin ${uuid()}`, padre: ciudad });
    await addGeometria(pool, conLimite);

    const encontradas = await repo.findGeometriesByZoneIds([conLimite, sinLimite]);

    // Distinguir «sin geometría» de «zona inexistente» es del caso de uso (C2):
    // el repositorio solo devuelve lo que existe.
    assert.deepEqual(
      encontradas.map((g) => g.zoneId),
      [conLimite]
    );
  });

  await t.test('sin ids no consulta y devuelve vacío', async () => {
    assert.deepEqual(await repo.findGeometriesByZoneIds([]), []);
    assert.deepEqual(await repo.findGeometriesByZoneIds(null), []);
  });

  await t.test('un id desconocido no devuelve nada ni falla', async () => {
    assert.deepEqual(await repo.findGeometriesByZoneIds([uuid()]), []);
  });

  await t.test('findById rehidrata la zona y null si no existe', async () => {
    const ciudad = await addZona(pool, { nivel: 'CIUDAD', nombre: `Ciudad ${uuid()}` });
    const nombre = `Localidad ${uuid()}`;
    const id = await addZona(pool, { nivel: 'LOCALIDAD', nombre, padre: ciudad });

    const zona = await repo.findById(id);

    assert.equal(zona.id, id);
    assert.equal(zona.name, nombre);
    assert.equal(zona.level, 'LOCALIDAD');
    assert.equal(zona.parentId, ciudad);
    assert.equal(zona.active, true);
    assert.equal(await repo.findById(uuid()), null);
  });

  await t.test('onlyActive filtra en la consulta y acepta ACTIVO y ACTIVA', async () => {
    const ciudad = await addZona(pool, { nivel: 'CIUDAD', nombre: `Ciudad ${uuid()}` });
    const activo = await addZona(pool, { nivel: 'LOCALIDAD', nombre: `Act ${uuid()}`, padre: ciudad });
    // El seed de QA escribe 'ACTIVO' y el de solicitudes acepta 'ACTIVA':
    // ambas formas tienen que contar como activa.
    const activa = await addZona(pool, { nivel: 'LOCALIDAD', nombre: `Acta ${uuid()}`, padre: ciudad, estado: 'ACTIVA' });
    const inactiva = await addZona(pool, {
      nivel: 'LOCALIDAD',
      nombre: `Ina ${uuid()}`,
      padre: ciudad,
      estado: 'INACTIVO',
    });

    const ids = new Set((await repo.findAll({ onlyActive: true })).map((z) => z.id));

    assert.ok(ids.has(activo));
    assert.ok(ids.has(activa));
    assert.ok(!ids.has(inactiva));
    assert.ok(new Set((await repo.findAll()).map((z) => z.id)).has(inactiva));
  });
});
