const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RegisterCompanyClientWithSitesUseCase } = require('../../../src/features/client/application/RegisterCompanyClientWithSitesUseCase');
const { PostgresCompanyClientRepository } = require('../../../src/features/client/infrastructure/PostgresCompanyClientRepository');

describe('RegisterCompanyClientWithSitesUseCase (US-02.2.2 / RF-08)', () => {
  let repo;
  let useCase;

  beforeEach(() => {
    repo = new PostgresCompanyClientRepository();
    useCase = new RegisterCompanyClientWithSitesUseCase(repo);
  });

  it('Scenario 1: debe registrar exitosamente una organización con múltiples sitios', async () => {
    const input = {
      tenantId: 'tenant-trama-1',
      razonSocial: 'Logística Nacional S.A.S.',
      nit: '900987654-3',
      email: 'operaciones@logisticanacional.com',
      telefono: '3157894561',
      nombreRepresentante: 'Martín Barreto',
      sitios: [
        {
          nombre: 'Centro de Distribución Álamos',
          direccion: 'Avenida Calle 26 # 92-32',
          zonaId: 'zona-bogota-occidente',
          reglas: { horarioAcceso: '24h', requiereEPI: true },
        },
        {
          nombre: 'Sede Administrativa Chicó',
          direccion: 'Carrera 11 # 94-02 Piso 5',
          zonaId: 'zona-bogota-norte',
          reglas: { horarioAcceso: '08:00 - 18:00' },
        },
      ],
      correlationId: 'test-corr-001',
    };

    const result = await useCase.execute(input);

    assert.strictEqual(result.isNew, true);
    assert.ok(result.client.id);
    assert.strictEqual(result.client.razonSocial, 'Logística Nacional S.A.S.');
    assert.strictEqual(result.client.tipo, 'EMPRESA');
    assert.strictEqual(result.client.estado, 'ACTIVO');
    assert.strictEqual(result.sites.length, 2);
    assert.strictEqual(result.sites[0].nombre, 'Centro de Distribución Álamos');
    assert.strictEqual(result.sites[1].nombre, 'Sede Administrativa Chicó');
  });

  it('Scenario 2: debe rechazar si los datos de la empresa son inválidos', async () => {
    const invalidInput = {
      tenantId: 'tenant-trama-1',
      razonSocial: 'A', // Muy corto
      nit: '123',       // Muy corto
      email: 'invalido',
      sitios: [],
    };

    await assert.rejects(
      async () => await useCase.execute(invalidInput),
      /razonSocial es requerida/
    );
  });

  it('Scenario 2b: debe rechazar si alguno de los sitios no tiene zonaId (regla RF-09)', async () => {
    const input = {
      tenantId: 'tenant-trama-1',
      razonSocial: 'Empresa Test',
      nit: '900123456-7',
      email: 'test@empresa.com',
      sitios: [
        {
          nombre: 'Sede Sin Zona',
          direccion: 'Calle 50 # 10-20',
          zonaId: '', // Falta zona
        },
      ],
    };

    await assert.rejects(
      async () => await useCase.execute(input),
      /Sitio #1 inválido: zonaId es requerida/
    );
  });

  it('Scenario 3: idempotencia - si la empresa ya existe con el mismo NIT retorna el registro existente', async () => {
    const input = {
      tenantId: 'tenant-trama-1',
      razonSocial: 'Distribuciones SAS',
      nit: '900555666-1',
      email: 'info@distribuciones.com',
      sitios: [
        {
          nombre: 'Sede Principal',
          direccion: 'Calle 80 # 68-10',
          zonaId: 'zona-bogota-norte',
        },
      ],
    };

    const firstResult = await useCase.execute(input);
    assert.strictEqual(firstResult.isNew, true);

    // Segundo llamado idéntico
    const secondResult = await useCase.execute(input);
    assert.strictEqual(secondResult.isNew, false);
    assert.strictEqual(secondResult.client.id, firstResult.client.id);
    assert.strictEqual(secondResult.sites.length, 1);
  });
});
