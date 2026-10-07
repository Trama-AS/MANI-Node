const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PostgresCompanyClientRepository } = require('../../../src/features/client/infrastructure/PostgresCompanyClientRepository');
const { CompanyClient } = require('../../../src/features/client/domain/CompanyClient');
const { Site } = require('../../../src/features/client/domain/Site');

function createMockPgPool(queryHandler) {
  const queries = [];
  let clientReleased = false;

  const mockClient = {
    query: async (sql, params) => {
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

  const mockPool = {
    connect: async () => mockClient,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queryHandler) {
        return queryHandler(sql, params);
      }
      return { rows: [] };
    },
  };

  return { mockPool, queries, isClientReleased: () => clientReleased };
}

describe('PostgresCompanyClientRepository (SQL Path & Transaction Coverage)', () => {
  it('save ejecuta BEGIN, INSERT usuario, INSERT cliente, INSERT sitio y COMMIT exitosamente', async () => {
    const { mockPool, queries, isClientReleased } = createMockPgPool();
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });

    const company = new CompanyClient({
      tenantId: 'tenant-uuid-1',
      razonSocial: 'Empresa Test SQL',
      nit: '900123456-1',
      email: 'test@sql.com',
      telefono: '3001234567',
      nombreRepresentante: 'Representante SQL',
    });

    const site = new Site({
      tenantId: 'tenant-uuid-1',
      nombre: 'Sede Norte',
      direccion: 'Calle 100 # 20-30',
      zonaId: 'zona-uuid-1',
      reglas: { acceso: 'restringido' },
    });

    const result = await repo.save(company, [site], { userId: 'auth-user-123' });

    assert.ok(result.client.id);
    assert.strictEqual(result.client.usuarioId, 'auth-user-123');
    assert.strictEqual(result.sites.length, 1);
    assert.ok(result.sites[0].id);

    // Verificar flujo transaccional en SQL
    const sqlCommands = queries.map((q) => q.sql.trim());
    assert.strictEqual(sqlCommands[0], 'BEGIN');
    assert.ok(sqlCommands[1].includes('INSERT INTO usuario'));
    assert.ok(sqlCommands[2].includes('INSERT INTO cliente'));
    assert.ok(sqlCommands[3].includes('INSERT INTO sitio'));
    assert.strictEqual(sqlCommands[4], 'COMMIT');
    assert.strictEqual(isClientReleased(), true);
  });

  it('save ejecuta ROLLBACK si alguna consulta dentro de la transacción falla', async () => {
    const { mockPool, queries, isClientReleased } = createMockPgPool((sql) => {
      if (sql.includes('INSERT INTO cliente')) {
        throw new Error('violación de llave foránea simulada');
      }
      return { rows: [] };
    });

    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });

    const company = new CompanyClient({
      tenantId: 'tenant-uuid-1',
      razonSocial: 'Empresa Error SQL',
      nit: '900999999-1',
      email: 'err@sql.com',
    });

    await assert.rejects(
      async () => {
        await repo.save(company, []);
      },
      /violación de llave foránea simulada/
    );

    const sqlCommands = queries.map((q) => q.sql.trim());
    assert.strictEqual(sqlCommands[0], 'BEGIN');
    assert.ok(sqlCommands.includes('ROLLBACK'));
    assert.strictEqual(isClientReleased(), true);
  });

  it('findById consulta con clienteId y tenantId y mapea a CompanyClient', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      if (sql.includes('SELECT c.id')) {
        return {
          rows: [
            {
              id: params[0],
              tenant_id: params[1],
              razon_social: 'Empresa Encontrada',
              nit: '900555444-1',
              email: 'info@encontrada.com',
              telefono: '3115554433',
              tipo: 'EMPRESA',
              estado: 'ACTIVO',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const client = await repo.findById('client-123', 'tenant-123');

    assert.ok(client);
    assert.strictEqual(client.id, 'client-123');
    assert.strictEqual(client.razonSocial, 'Empresa Encontrada');
    assert.strictEqual(queries[0].params[0], 'client-123');
    assert.strictEqual(queries[0].params[1], 'tenant-123');
  });

  it('findByNitAndTenant filtra exactamente por NIT y tenantId', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      return {
        rows: [
          {
            id: 'client-nit-1',
            tenant_id: params[1],
            razon_social: 'Empresa Por NIT',
            nit: params[0],
            email: 'nit@test.com',
            tipo: 'EMPRESA',
            estado: 'ACTIVO',
          },
        ],
      };
    });

    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const client = await repo.findByNitAndTenant('900111222-3', 'tenant-xyz');

    assert.ok(client);
    assert.strictEqual(client.nit, '900111222-3');
    assert.strictEqual(queries[0].params[0], '900111222-3');
    assert.strictEqual(queries[0].params[1], 'tenant-xyz');
  });

  it('findByEmailAndTenant busca insensible a mayúsculas/minúsculas', async () => {
    const { mockPool, queries } = createMockPgPool((sql, params) => {
      return {
        rows: [
          {
            id: 'client-email-1',
            tenant_id: params[1],
            razon_social: 'Empresa Por Email',
            nit: '900333444-1',
            email: params[0],
            tipo: 'EMPRESA',
            estado: 'ACTIVO',
          },
        ],
      };
    });

    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const client = await repo.findByEmailAndTenant('TEST@EMAIL.COM', 'tenant-xyz');

    assert.ok(client);
    assert.strictEqual(queries[0].params[0], 'TEST@EMAIL.COM');
  });

  it('addSite y findSitesByClientId gestionan sitios y reglas JSONB', async () => {
    const { mockPool } = createMockPgPool((sql, params) => {
      if (sql.includes('SELECT id, tenant_id, cliente_id')) {
        return {
          rows: [
            {
              id: 'site-uuid-1',
              tenant_id: params[1],
              cliente_id: params[0],
              zona_id: 'zona-1',
              direccion: 'Calle 10 # 20-30',
              nombre: 'Sede Principal',
              reglas: '{"horario":"07:00-18:00"}',
              created_at: new Date(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });

    const newSite = await repo.addSite('client-1', 'tenant-1', new Site({
      tenantId: 'tenant-1',
      clienteId: 'client-1',
      nombre: 'Sede Sucursal',
      direccion: 'Carrera 7 # 15-20',
      zonaId: 'zona-2',
      reglas: { parqueadero: true },
    }));

    assert.ok(newSite.id);
    assert.strictEqual(newSite.nombre, 'Sede Sucursal');

    const sites = await repo.findSitesByClientId('client-1', 'tenant-1');
    assert.strictEqual(sites.length, 1);
    assert.strictEqual(sites[0].nombre, 'Sede Principal');
    assert.strictEqual(sites[0].reglas.horario, '07:00-18:00');
  });

  it('lanza DomainError si se invoca sin conexión ni factory', () => {
    const repo = new PostgresCompanyClientRepository({});
    assert.throws(() => repo._getPool(), /DATABASE_URL no configurada/);
  });
});
