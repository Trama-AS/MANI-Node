const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RegisterCompanyClientWithSitesUseCase } = require('../../../../src/features/client/application/RegisterCompanyClientWithSitesUseCase');
const { InMemoryCompanyClientRepository } = require('../../../../src/features/client/infrastructure/InMemoryCompanyClientRepository');

describe('RegisterCompanyClientWithSitesUseCase (US-02.2.2 / RF-08)', () => {
  it('Scenario 1: debe registrar exitosamente una organización con múltiples sitios', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const mockAuthService = {
      createUser: async () => {
        return { userId: 'auth-user-uuid-999' };
      },
    };

    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: mockAuthService,
    });

    const result = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Logística Nacional S.A.S.',
      nit: '900123456-1',
      email: 'contacto@logisticanacional.com',
      telefono: '6012345678',
      nombreRepresentante: 'Carlos Mario Mendoza',
      sitios: [
        {
          nombre: 'Bodega Central Fontibón',
          direccion: 'Calle 17 # 100-20',
          zonaId: 'zona-bogota-occidente',
          reglas: { tipoAcceso: 'muelle_carga', requiereEpi: true },
        },
        {
          nombre: 'Centro Distribución Álamos',
          direccion: 'Avenida Calle 63 # 93-45',
          zonaId: 'zona-bogota-noroeste',
          reglas: { tipoAcceso: 'peatonal_y_carga' },
        },
      ],
      correlationId: 'test-corr-001',
    });

    assert.strictEqual(result.isNew, true);
    assert.strictEqual(result.client.razonSocial, 'Logística Nacional S.A.S.');
    assert.strictEqual(result.client.nit, '900123456-1');
    assert.strictEqual(result.client.tipo, 'EMPRESA');
    assert.strictEqual(result.client.usuarioId, 'auth-user-uuid-999');
    assert.strictEqual(result.sites.length, 2);
    assert.strictEqual(result.sites[0].nombre, 'Bodega Central Fontibón');
    assert.strictEqual(result.sites[1].nombre, 'Centro Distribución Álamos');
    assert.ok(result.client.id);
    assert.ok(result.sites[0].id);
  });

  it('Scenario 2: debe rechazar si los datos de la empresa son inválidos', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: '',
          nit: '1',
          email: 'invalido',
          sitios: [],
        });
      },
      /razonSocial es requerida/
    );
  });

  it('Scenario 3: debe rechazar si alguno de los sitios no tiene zonaId (regla RF-09)', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: 'Constructora Bolívar S.A.',
          nit: '860000000-1',
          email: 'obras@bolivar.com',
          sitios: [
            {
              nombre: 'Obra 1',
              direccion: 'Carrera 7 # 120-10',
              zonaId: '',
            },
          ],
        });
      },
      /zonaId es requerida/
    );
  });

  it('Scenario 4: idempotencia - si la empresa ya existe con el mismo NIT retorna el registro existente', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    const primerRegistro = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Distribuciones SAS',
      nit: '900555666-1',
      email: 'distribuciones@test.com',
      sitios: [
        {
          nombre: 'Sede 1',
          direccion: 'Calle 50 # 10-20',
          zonaId: 'zona-1',
        },
      ],
    });

    assert.strictEqual(primerRegistro.isNew, true);

    const segundoRegistro = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Distribuciones SAS Duplicada',
      nit: '900555666-1',
      email: 'otro-correo@test.com',
      sitios: [],
    });

    assert.strictEqual(segundoRegistro.isNew, false);
    assert.strictEqual(segundoRegistro.client.id, primerRegistro.client.id);
    assert.strictEqual(segundoRegistro.client.nit, '900555666-1');
  });

  it('Scenario 5: idempotencia - si la empresa ya existe con el mismo Email retorna el registro existente', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    const primerRegistro = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Email SAS',
      nit: '900888999-1',
      email: 'repetido@test.com',
      sitios: [
        {
          nombre: 'Sede A',
          direccion: 'Calle 10 # 20-30',
          zonaId: 'zona-1',
        },
      ],
    });

    assert.strictEqual(primerRegistro.isNew, true);

    const segundoRegistro = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Email SAS Dos',
      nit: '900111222-1',
      email: 'repetido@test.com',
      sitios: [],
    });

    assert.strictEqual(segundoRegistro.isNew, false);
    assert.strictEqual(segundoRegistro.client.id, primerRegistro.client.id);
  });
});
