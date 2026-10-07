const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ConfigureSiteRulesUseCase } = require('../../../src/features/client/application/ConfigureSiteRulesUseCase');
const { GetSiteRulesForAllyUseCase } = require('../../../src/features/client/application/GetSiteRulesForAllyUseCase');
const { ValidateAllyScheduleUseCase } = require('../../../src/features/client/application/ValidateAllyScheduleUseCase');
const { PostgresCompanyClientRepository } = require('../../../src/features/client/infrastructure/PostgresCompanyClientRepository');
const { Site } = require('../../../src/features/client/domain/Site');

describe('Site Rules Use Cases (US-02.2.3 / RF-09)', () => {
  let repo;
  let configureUseCase;
  let getRulesUseCase;
  let validateScheduleUseCase;
  let testSite;

  beforeEach(async () => {
    repo = new PostgresCompanyClientRepository();
    configureUseCase = new ConfigureSiteRulesUseCase(repo);
    getRulesUseCase = new GetSiteRulesForAllyUseCase(repo);
    validateScheduleUseCase = new ValidateAllyScheduleUseCase(repo);

    testSite = await repo.addSite('cliente-corp-1', 'tenant-trama-1', new Site({
      tenantId: 'tenant-trama-1',
      clienteId: 'cliente-corp-1',
      nombre: 'Planta de Producción Tocancipá',
      direccion: 'Km 22 Vía Briceño',
      zonaId: 'zona-sabana-norte',
    }));
  });

  it('ConfigureSiteRulesUseCase debe configurar reglas y guardarlas en el sitio', async () => {
    const result = await configureUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
      reglas: {
        horario: { inicio: '07:00', fin: '16:00', diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'] },
        permisosRequeridos: ['ARL_RIESGO_IV', 'CERTIFICADO_ALTURAS'],
        elementosProteccion: ['BOTAS_PUNTA_ACERO', 'CASCO', 'CHALECO_REFLECTIVO'],
        instruccionesIngreso: 'Ingreso por garita 2 con planilla de seguridad social.',
      },
    });

    assert.ok(result.site.reglas);
    assert.strictEqual(result.reglas.horario.inicio, '07:00');
    assert.strictEqual(result.reglas.permisosRequeridos.length, 2);
  });

  it('GetSiteRulesForAllyUseCase (Scenario 1) debe exponer las reglas destacadas al aliado', async () => {
    // 1. Configurar reglas
    await configureUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
      reglas: {
        horario: { inicio: '08:00', fin: '17:00' },
        permisosRequeridos: ['ARL_VIGENTE'],
        elementosProteccion: ['CASCO', 'BOTAS_SEGURIDAD'],
      },
    });

    // 2. Consultar como aliado
    const vista = await getRulesUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
    });

    assert.strictEqual(vista.tieneRestricciones, true);
    assert.strictEqual(vista.reglasDestacadas.horarioAcceso.rango, '08:00 - 17:00');
    assert.deepStrictEqual(vista.reglasDestacadas.permisosObligatorios, ['ARL_VIGENTE']);
    assert.strictEqual(vista.reglasDestacadas.totalRequisitos, 3);
  });

  it('ValidateAllyScheduleUseCase (Scenario 2): horario 19:00 fuera de rango exige justificación', async () => {
    await configureUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
      reglas: {
        horario: { inicio: '08:00', fin: '17:00', diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'] },
      },
    });

    // Intento de agenda a las 19:00 sin justificación -> REQUIERE_JUSTIFICACION
    const intentoSinJustificacion = await validateScheduleUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
      fechaHoraPropuesta: '2026-10-14T19:00:00',
    });

    assert.strictEqual(intentoSinJustificacion.cumpleHorario, false);
    assert.strictEqual(intentoSinJustificacion.requiereJustificacion, true);
    assert.strictEqual(intentoSinJustificacion.estadoValidacion, 'REQUIERE_JUSTIFICACION');
    assert.ok(intentoSinJustificacion.advertencia.includes('ADVERTENCIA'));

    // Intento con justificación explícita -> APROBADO_CON_JUSTIFICACION
    const intentoConJustificacion = await validateScheduleUseCase.execute({
      siteId: testSite.id,
      tenantId: 'tenant-trama-1',
      fechaHoraPropuesta: '2026-10-14T19:00:00',
      justificacion: 'Falla eléctrica mayor fuera de turno operativo autorizada por gerencia',
    });

    assert.strictEqual(intentoConJustificacion.estadoValidacion, 'APROBADO_CON_JUSTIFICACION');
  });
});
