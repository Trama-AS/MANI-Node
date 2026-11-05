const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PostgresSiteRepository = require('../../../src/infrastructure/repositories/PostgresSiteRepository');
const Site = require('../../../src/domain/entities/Site');
const SiteRules = require('../../../src/domain/entities/SiteRules');

const CONTROL = /^(BEGIN|COMMIT|ROLLBACK)$/;

/**
 * Pool falso con transacciones (SCRUM-1468: cada consulta corre en una transacción con app.set_context).
 * `queries` guarda solo las sentencias de datos; `todas` también BEGIN/COMMIT/ROLLBACK; `contextos`, los parámetros
 * de cada app.set_context.
 */
function createMockPgPool(queryHandler) {
  const queries = [];
  const todas = [];
  const contextos = [];
  let clientReleased = false;

  const mockClient = {
    query: async (sql, params) => {
      const texto = sql.trim();
      if (texto.startsWith('SELECT app.set_context')) {
        contextos.push(params);
        return { rows: [] };
      }
      todas.push({ sql, params });
      if (CONTROL.test(texto)) return { rows: [] };
      queries.push({ sql, params });
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
    release: () => {
      clientReleased = true;
    },
  };

  const mockPool = { connect: async () => mockClient };

  return { mockPool, queries, todas, contextos, isClientReleased: () => clientReleased };
}

describe('PostgresSiteRepository (SQL Path Coverage)', () => {
  it('hasRequestInSite busca las solicitudes dadas en ese sitio y tenant (SCRUM-853)', async () => {
    const { mockPool, queries } = createMockPgPool(() => ({ rows: [{ '?column?': 1 }] }));
    const repo = new PostgresSiteRepository({ pgPool: mockPool });

    const resultado = await repo.hasRequestInSite('sitio-1', '11111111-1111-4111-8111-111111111111', ['sol-1', 'sol-2']);

    assert.equal(resultado, true);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /FROM solicitud/);
    assert.match(queries[0].sql, /tenant_id = \$1 AND sitio_id = \$2 AND id = ANY\(\$3::uuid\[\]\)/);
    assert.deepEqual(queries[0].params, ['11111111-1111-4111-8111-111111111111', 'sitio-1', ['sol-1', 'sol-2']]);
  });

  it('hasRequestInSite sin solicitudes no consulta la base y responde false', async () => {
    const { mockPool, queries } = createMockPgPool();
    const repo = new PostgresSiteRepository({ pgPool: mockPool });

    assert.equal(await repo.hasRequestInSite('sitio-1', '11111111-1111-4111-8111-111111111111', []), false);
    assert.equal(await repo.hasRequestInSite('sitio-1', '11111111-1111-4111-8111-111111111111', undefined), false);
    assert.equal(queries.length, 0);
  });

  it('hasRequestInSite responde false si ninguna solicitud es del sitio', async () => {
    const { mockPool } = createMockPgPool(() => ({ rows: [] }));
    const repo = new PostgresSiteRepository({ pgPool: mockPool });

    assert.equal(await repo.hasRequestInSite('sitio-1', '11111111-1111-4111-8111-111111111111', ['sol-otra']), false);
  });

  it('findById consulta con siteId y tenantId y mapea a Site con SiteRules', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      if (sql.includes('SELECT id, tenant_id')) {
        return {
          rows: [
            {
              id: params[0],
              tenant_id: params[1],
              cliente_id: 'client-1',
              zona_id: 'zona-1',
              direccion: 'Calle 100 # 15-20',
              nombre: 'Sede Principal',
              reglas: '{"horario":{"inicio":"08:00","fin":"17:00","diasPermitidos":["LUN"]}}',
              created_at: new Date(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const repo = new PostgresSiteRepository({ pgPool: mockPool });
    const site = await repo.findById('site-1', '11111111-1111-4111-8111-111111111111');

    assert.ok(site);
    assert.strictEqual(site.id, 'site-1');
    assert.strictEqual(site.nombre, 'Sede Principal');
    assert.ok(site.reglas instanceof SiteRules);
    assert.strictEqual(site.reglas.horario.inicio, '08:00');
    assert.strictEqual(queries[0].params[0], 'site-1');
    assert.strictEqual(queries[0].params[1], '11111111-1111-4111-8111-111111111111');
  });

  it('updateRules actualiza reglas JSONB en PostgreSQL y retorna entidad actualizada', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      if (sql.includes('UPDATE sitio')) {
        return {
          rows: [
            {
              id: params[1],
              tenant_id: params[2],
              cliente_id: 'client-1',
              zona_id: 'zona-1',
              direccion: 'Calle 100 # 15-20',
              nombre: 'Sede Principal',
              reglas: params[0],
              created_at: new Date(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const repo = new PostgresSiteRepository({ pgPool: mockPool });
    const newRules = new SiteRules({
      horario: { inicio: '07:00', fin: '18:00', diasPermitidos: ['LUN', 'MAR'] },
      permisosRequeridos: ['ARL'],
    });

    const updated = await repo.updateRules('site-1', '11111111-1111-4111-8111-111111111111', newRules);

    assert.ok(updated);
    assert.strictEqual(updated.id, 'site-1');
    assert.ok(/UPDATE\s+sitio\s+SET\s+reglas\s*=\s*\$1::jsonb/i.test(queries[0].sql));
    assert.strictEqual(queries[0].params[1], 'site-1');
    assert.strictEqual(queries[0].params[2], '11111111-1111-4111-8111-111111111111');
  });

  it('create inserta una nueva fila en tabla sitio', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      return {
        rows: [
          {
            id: params[0],
            tenant_id: params[1],
            cliente_id: params[2],
            zona_id: params[3],
            direccion: params[4],
            nombre: params[5],
            reglas: params[6],
            created_at: new Date(),
          },
        ],
      };
    });

    const repo = new PostgresSiteRepository({ pgPool: mockPool });
    const site = new Site({
      id: 'site-nuevo-1',
      tenantId: '11111111-1111-4111-8111-111111111111',
      clienteId: 'client-1',
      zonaId: 'zona-1',
      direccion: 'Carrera 7 # 32-10',
      nombre: 'Sede Nueva',
    });

    const created = await repo.create(site);
    assert.strictEqual(created.id, 'site-nuevo-1');
    assert.ok(queries[0].sql.includes('INSERT INTO sitio'));
  });

  it('lanza DomainError si no hay pool configurado', async () => {
    const repo = new PostgresSiteRepository({});
    await assert.rejects(() => repo.findById('s', '11111111-1111-4111-8111-111111111111'), /DATABASE_URL no configurada/);
  });
});
