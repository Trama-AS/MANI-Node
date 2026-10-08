const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PostgresSiteRepository = require('../../../src/infrastructure/repositories/PostgresSiteRepository');
const Site = require('../../../src/domain/entities/Site');
const SiteRules = require('../../../src/domain/entities/SiteRules');

function createMockPgPool(queryHandler) {
  const queries = [];
  const mockPool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
  };
  return { mockPool, queries };
}

describe('PostgresSiteRepository (SQL Path Coverage)', () => {
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
    const site = await repo.findById('site-1', 'tenant-1');

    assert.ok(site);
    assert.strictEqual(site.id, 'site-1');
    assert.strictEqual(site.nombre, 'Sede Principal');
    assert.ok(site.reglas instanceof SiteRules);
    assert.strictEqual(site.reglas.horario.inicio, '08:00');
    assert.strictEqual(queries[0].params[0], 'site-1');
    assert.strictEqual(queries[0].params[1], 'tenant-1');
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

    const updated = await repo.updateRules('site-1', 'tenant-1', newRules);

    assert.ok(updated);
    assert.strictEqual(updated.id, 'site-1');
    assert.ok(/UPDATE\s+sitio\s+SET\s+reglas\s*=\s*\$1::jsonb/i.test(queries[0].sql));
    assert.strictEqual(queries[0].params[1], 'site-1');
    assert.strictEqual(queries[0].params[2], 'tenant-1');
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
      tenantId: 'tenant-1',
      clienteId: 'client-1',
      zonaId: 'zona-1',
      direccion: 'Carrera 7 # 32-10',
      nombre: 'Sede Nueva',
    });

    const created = await repo.create(site);
    assert.strictEqual(created.id, 'site-nuevo-1');
    assert.ok(queries[0].sql.includes('INSERT INTO sitio'));
  });

  it('lanza DomainError si no hay pool configurado', () => {
    const repo = new PostgresSiteRepository({});
    assert.throws(() => repo._getPool(), /DATABASE_URL no configurada/);
  });
});
