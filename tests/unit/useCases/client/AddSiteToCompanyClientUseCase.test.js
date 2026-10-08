const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RegisterCompanyClientWithSitesUseCase } = require('../../../../src/features/client/application/RegisterCompanyClientWithSitesUseCase');
const { AddSiteToCompanyClientUseCase } = require('../../../../src/features/client/application/AddSiteToCompanyClientUseCase');
const { GetCompanyClientSitesUseCase } = require('../../../../src/features/client/application/GetCompanyClientSitesUseCase');
const { InMemoryCompanyClientRepository } = require('../../../../src/features/client/infrastructure/InMemoryCompanyClientRepository');

describe('AddSiteToCompanyClientUseCase & GetCompanyClientSitesUseCase (RF-08 / RF-09)', () => {
  it('Scenario 1: debe agregar un nuevo sitio a una empresa existente y luego poder consultarlo', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const registerUseCase = new RegisterCompanyClientWithSitesUseCase({ companyClientRepository: repository });
    const addSiteUseCase = new AddSiteToCompanyClientUseCase(repository);
    const getSitesUseCase = new GetCompanyClientSitesUseCase(repository);

    // 1. Registrar empresa inicial con 1 sitio
    const { client, sites: initialSites } = await registerUseCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Retail Colombia S.A.S.',
      nit: '900987654-3',
      email: 'operaciones@retail.com',
      sitios: [
        {
          nombre: 'Sede Chapinero',
          direccion: 'Carrera 13 # 60-15',
          zonaId: 'zona-bogota-centro',
        },
      ],
    });

    assert.strictEqual(initialSites.length, 1);

    // 2. Agregar un segundo sitio
    const addedSite = await addSiteUseCase.execute({
      clienteId: client.id,
      tenantId: 'tenant-trama-1',
      nombre: 'Sede Salitre',
      direccion: 'Avenida La Esperanza # 68-30',
      zonaId: 'zona-bogota-occidente',
      reglas: { parqueadero: true },
      correlationId: 'test-add-site-001',
    });

    assert.ok(addedSite.id);
    assert.strictEqual(addedSite.nombre, 'Sede Salitre');
    assert.strictEqual(addedSite.clienteId, client.id);

    // 3. Consultar todos los sitios de la empresa
    const { client: fetchedClient, sites: allSites } = await getSitesUseCase.execute({
      clienteId: client.id,
      tenantId: 'tenant-trama-1',
    });

    assert.strictEqual(fetchedClient.id, client.id);
    assert.strictEqual(allSites.length, 2);
    assert.strictEqual(allSites[0].nombre, 'Sede Chapinero');
    assert.strictEqual(allSites[1].nombre, 'Sede Salitre');
  });

  it('Scenario 2: debe fallar si el cliente no existe al agregar un sitio', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const addSiteUseCase = new AddSiteToCompanyClientUseCase(repository);

    await assert.rejects(
      async () => {
        await addSiteUseCase.execute({
          clienteId: 'cliente-inexistente',
          tenantId: 'tenant-trama-1',
          nombre: 'Sede Fantasma',
          direccion: 'Calle Falsa 123',
          zonaId: 'zona-1',
        });
      },
      /no encontrado/
    );
  });

  it('Scenario 3: debe rechazar consulta de sitios si el tenant no coincide (aislamiento cross-tenant)', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const registerUseCase = new RegisterCompanyClientWithSitesUseCase({ companyClientRepository: repository });
    const getSitesUseCase = new GetCompanyClientSitesUseCase(repository);

    const { client } = await registerUseCase.execute({
      tenantId: 'tenant-A',
      razonSocial: 'Empresa Tenant A',
      nit: '900111222-3',
      email: 'a@tenant-a.com',
      sitios: [{ direccion: 'Calle 100 # 20-30', zonaId: 'zona-1' }],
    });

    // Intentar leer desde tenant-B
    await assert.rejects(
      async () => {
        await getSitesUseCase.execute({
          clienteId: client.id,
          tenantId: 'tenant-B',
        });
      },
      /no encontrado en tenant "tenant-B"/
    );
  });

  it('Scenario 4: autorización - rechaza con 403 Forbidden si el usuario no es el propietario ni admin (DoD §9.3)', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const registerUseCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: { createUser: async () => ({ userId: 'propietario-user-id' }) },
    });
    const addSiteUseCase = new AddSiteToCompanyClientUseCase(repository);
    const getSitesUseCase = new GetCompanyClientSitesUseCase(repository);

    const { client } = await registerUseCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Empresa Privada S.A.S.',
      nit: '900123999-5',
      email: 'privada@empresa.com',
      sitios: [{ direccion: 'Calle 1 # 2-3', zonaId: 'zona-1' }],
    });

    // Intentar agregar sede con usuario ajeno (rol CLIENTE)
    await assert.rejects(
      async () => {
        await addSiteUseCase.execute({
          clienteId: client.id,
          tenantId: 'tenant-trama-1',
          nombre: 'Sede No Autorizada',
          direccion: 'Carrera 15 # 80-20',
          zonaId: 'zona-1',
          userId: 'intruso-user-id',
          userRole: 'CLIENTE',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // Intentar consultar sedes con usuario ajeno (rol CLIENTE)
    await assert.rejects(
      async () => {
        await getSitesUseCase.execute({
          clienteId: client.id,
          tenantId: 'tenant-trama-1',
          userId: 'intruso-user-id',
          userRole: 'CLIENTE',
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // Como ADMIN de tenant sí puede consultar y agregar
    const adminQuery = await getSitesUseCase.execute({
      clienteId: client.id,
      tenantId: 'tenant-trama-1',
      userId: 'admin-user-id',
      userRole: 'ADMIN_TENANT',
    });
    assert.strictEqual(adminQuery.sites.length, 1);
  });
});
