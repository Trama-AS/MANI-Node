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
    assert.strictEqual(result.client.tipo, 'PERSONA_JURIDICA');
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

  it('Scenario 4: prevención de fuga de datos - rechaza con 409 Conflict si el NIT ya existe (DoD §9.3)', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    await useCase.execute({
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

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: 'Distribuciones SAS Intruso',
          nit: '900555666-1',
          email: 'otro-correo@test.com',
          sitios: [],
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, 'NIT_ALREADY_REGISTERED');
        return true;
      }
    );
  });

  it('Scenario 5: prevención de fuga de datos - rechaza con 409 Conflict si el Email ya existe', async () => {
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
    });

    await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Email SAS',
      nit: '900888999-1',
      email: 'repetido@test.com',
      sitios: [],
    });

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: 'Email SAS Dos',
          nit: '900111222-1',
          email: 'repetido@test.com',
          sitios: [],
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, 'EMAIL_ALREADY_REGISTERED');
        return true;
      }
    );
  });

  it('Scenario 6: SAGA Compensation - elimina usuario creado en Auth si falla el guardado en repositorio', async () => {
    let deletedUserId = null;
    const mockAuthService = {
      createUser: async () => ({ userId: 'auth-compensate-uuid' }),
      deleteUser: async (id) => {
        deletedUserId = id;
      },
    };
    const failingRepo = {
      findByNitAndTenant: async () => null,
      findByEmailAndTenant: async () => null,
      save: async () => {
        throw new Error('Database connection lost');
      },
    };

    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: failingRepo,
      authIdentityService: mockAuthService,
    });

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: 'Empresa Falla S.A.',
          nit: '900999000-1',
          email: 'falla@empresa.com',
          sitios: [],
        });
      },
      /Database connection lost/
    );

    assert.strictEqual(deletedUserId, 'auth-compensate-uuid');
  });

  it('Scenario 7: rechaza con 409 si el email ya existe en Supabase Auth', async () => {
    const mockAuthService = {
      createUser: async () => {
        const err = new Error('User already registered');
        err.code = 'EMAIL_ALREADY_REGISTERED';
        throw err;
      },
    };
    const repository = new InMemoryCompanyClientRepository();
    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: mockAuthService,
    });

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId: 'tenant-trama-1',
          razonSocial: 'Empresa Auth Dup',
          nit: '900888777-1',
          email: 'dup@auth.com',
          sitios: [],
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, 'EMAIL_ALREADY_REGISTERED');
        return true;
      }
    );
  });

  it('Scenario 8: no contiene contraseña fija hardcodeada (Políticas DevOps §15)', async () => {
    const repository = new InMemoryCompanyClientRepository();
    let authUserPassword = null;
    const mockAuthService = {
      createUser: async ({ password }) => {
        authUserPassword = password;
        return { userId: 'auth-user-pwd' };
      },
    };

    const useCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: mockAuthService,
    });

    const res = await useCase.execute({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Seguridad Sin Hardcode',
      nit: '900777666-1',
      email: 'seguridad@empresa.com',
      sitios: [],
    });

    assert.ok(authUserPassword);
    assert.notStrictEqual(authUserPassword, 'ManiClient2026!');
    assert.strictEqual(res.temporaryPassword, authUserPassword);
    assert.ok(authUserPassword.length >= 10);
  });
});
