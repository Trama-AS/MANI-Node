const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PostgresCompanyClientRepository = require('../../../src/infrastructure/repositories/PostgresCompanyClientRepository');
const CompanyClient = require('../../../src/domain/entities/CompanyClient');
const Site = require('../../../src/domain/entities/Site');

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

  const filaSitio = {
    id: 'sitio-1',
    tenant_id: 'tenant-uuid-1',
    cliente_id: 'cliente-1',
    zona_id: 'zona-2',
    direccion: 'Carrera 7 # 64-20',
    nombre: 'Sede Editada',
    reglas: '{"requiereEpi":true}',
    contacto_nombre: 'Laura',
    contacto_telefono: null,
    created_at: new Date('2026-10-01T00:00:00Z'),
  };

  it('findSiteById filtra por sitio, cliente y tenant (SCRUM-1387)', async () => {
    const { mockPool, queries } = createMockPgPool(() => ({ rows: [filaSitio] }));
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });

    const sitio = await repo.findSiteById('cliente-1', 'sitio-1', 'tenant-uuid-1');

    assert.match(queries[0].sql, /WHERE id = \$1 AND cliente_id = \$2 AND tenant_id = \$3/);
    assert.deepStrictEqual(queries[0].params, ['sitio-1', 'cliente-1', 'tenant-uuid-1']);
    assert.ok(sitio instanceof Site);
    assert.deepStrictEqual(sitio.reglas, { requiereEpi: true });
  });

  it('findSiteById devuelve null si la sede no es de ese cliente o tenant', async () => {
    const { mockPool } = createMockPgPool(() => ({ rows: [] }));
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });

    assert.strictEqual(await repo.findSiteById('cliente-1', 'sitio-x', 'tenant-uuid-1'), null);
  });

  it('updateSite actualiza solo los campos editables, filtrando por sitio, cliente y tenant, sin tocar reglas', async () => {
    const { mockPool, queries } = createMockPgPool(() => ({ rows: [filaSitio] }));
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const sitio = new Site({
      id: 'sitio-1',
      tenantId: 'tenant-uuid-1',
      clienteId: 'cliente-1',
      nombre: 'Sede Editada',
      direccion: 'Carrera 7 # 64-20',
      zonaId: 'zona-2',
      contactoNombre: 'Laura',
    });

    const guardado = await repo.updateSite('cliente-1', 'tenant-uuid-1', sitio);

    assert.match(queries[0].sql, /^UPDATE sitio/);
    assert.match(queries[0].sql, /WHERE id = \$1 AND cliente_id = \$2 AND tenant_id = \$3/);
    assert.doesNotMatch(queries[0].sql, /reglas =/);
    assert.deepStrictEqual(queries[0].params, [
      'sitio-1',
      'cliente-1',
      'tenant-uuid-1',
      'Sede Editada',
      'Carrera 7 # 64-20',
      'zona-2',
      'Laura',
      null,
    ]);
    assert.strictEqual(guardado.nombre, 'Sede Editada');
  });

  it('updateSite devuelve null si no actualizó ninguna fila', async () => {
    const { mockPool } = createMockPgPool(() => ({ rows: [] }));
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const sitio = new Site({ id: 'sitio-x', tenantId: 't', clienteId: 'c', direccion: 'Calle 1 # 2-3', zonaId: 'z' });

    assert.strictEqual(await repo.updateSite('c', 't', sitio), null);
  });

  for (const code of ['23503', '22P02']) {
    it(`updateSite traduce el error ${code} de zona inexistente o inválida a error de validación`, async () => {
      const { mockPool } = createMockPgPool(() => {
        throw Object.assign(new Error('pg'), { code });
      });
      const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
      const sitio = new Site({ id: 's', tenantId: 't', clienteId: 'c', direccion: 'Calle 1 # 2-3', zonaId: 'no-existe' });

      await assert.rejects(repo.updateSite('c', 't', sitio), (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      });
    });
  }

  it('updateSite propaga cualquier otro error de la base', async () => {
    const { mockPool } = createMockPgPool(() => {
      throw Object.assign(new Error('conexión caída'), { code: '08006' });
    });
    const repo = new PostgresCompanyClientRepository({ pgPool: mockPool });
    const sitio = new Site({ id: 's', tenantId: 't', clienteId: 'c', direccion: 'Calle 1 # 2-3', zonaId: 'z' });

    await assert.rejects(repo.updateSite('c', 't', sitio), /conexión caída/);
  });

  it('lanza DomainError si se invoca sin conexión ni factory', () => {
    const repo = new PostgresCompanyClientRepository({});
    assert.throws(() => repo._getPool(), /DATABASE_URL no configurada/);
  });
});
