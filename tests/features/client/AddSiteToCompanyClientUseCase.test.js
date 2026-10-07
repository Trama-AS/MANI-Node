const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RegisterCompanyClientWithSitesUseCase } = require('../../../src/features/client/application/RegisterCompanyClientWithSitesUseCase');
const { AddSiteToCompanyClientUseCase } = require('../../../src/features/client/application/AddSiteToCompanyClientUseCase');
const { GetCompanyClientSitesUseCase } = require('../../../src/features/client/application/GetCompanyClientSitesUseCase');
const { PostgresCompanyClientRepository } = require('../../../src/features/client/infrastructure/PostgresCompanyClientRepository');

describe('AddSiteToCompanyClientUseCase & GetCompanyClientSitesUseCase (RF-08 / RF-09)', () => {
  let repo;
  let registerUseCase;
  let addSiteUseCase;
  let getSitesUseCase;

  beforeEach(() => {
    repo = new PostgresCompanyClientRepository();
    registerUseCase = new RegisterCompanyClientWithSitesUseCase(repo);
    addSiteUseCase = new AddSiteToCompanyClientUseCase(repo);
    getSitesUseCase = new GetCompanyClientSitesUseCase(repo);
  });

  it('Scenario 4: debe agregar un nuevo sitio a una empresa existente y luego poder consultarlo', async () => {
    // 1. Registrar empresa inicial con 1 sitio
    const { client } = await registerUseCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Retail Colombia S.A.S.',
      nit: '900444333-2',
      email: 'operaciones@retailco.com',
      sitios: [
        {
          nombre: 'Sede Centro',
          direccion: 'Carrera 7 # 19-28',
          zonaId: 'zona-bogota-centro',
        },
      ],
    });

    // 2. Agregar un segundo sitio posteriormente
    const nuevoSitio = await addSiteUseCase.execute({
      clienteId: client.id,
      tenantId: 'tenant-trama-1',
      nombre: 'Sede Salitre',
      direccion: 'Avenida La Esperanza # 50-10',
      zonaId: 'zona-bogota-salitre',
      reglas: { horarioAcceso: '08:00 - 18:00' },
      correlationId: 'test-add-site-001',
    });

    assert.ok(nuevoSitio.id);
    assert.strictEqual(nuevoSitio.nombre, 'Sede Salitre');
    assert.strictEqual(nuevoSitio.zonaId, 'zona-bogota-salitre');

    // 3. Consultar todos los sitios de la empresa
    const { sites } = await getSitesUseCase.execute({
      clienteId: client.id,
      tenantId: 'tenant-trama-1',
    });

    assert.strictEqual(sites.length, 2);
  });

  it('debe fallar si el cliente no existe al agregar un sitio', async () => {
    await assert.rejects(
      async () =>
        await addSiteUseCase.execute({
          clienteId: 'cliente-inexistente',
          tenantId: 'tenant-trama-1',
          direccion: 'Calle 100 # 20-30',
          zonaId: 'zona-1',
        }),
      /Cliente con ID "cliente-inexistente" no encontrado/
    );
  });
});
