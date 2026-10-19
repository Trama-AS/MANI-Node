const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const InMemorySiteRepository = require('../../../../src/infrastructure/repositories/InMemorySiteRepository');
const InMemoryClientRepository = require('../../../../src/infrastructure/repositories/InMemoryClientRepository');
const { ForbiddenError } = require('../../../../src/domain/errors/DomainError');
const ConfigureSiteRulesUseCase = require('../../../../src/application/useCases/sites/ConfigureSiteRulesUseCase');
const GetSiteRulesForAllyUseCase = require('../../../../src/application/useCases/sites/GetSiteRulesForAllyUseCase');
const ValidateAllyScheduleUseCase = require('../../../../src/application/useCases/sites/ValidateAllyScheduleUseCase');

describe('Site Rules Use Cases (RF-09 / QS-06)', () => {
  it('ConfigureSiteRulesUseCase debe configurar exitosamente las reglas de una sede', async () => {
    const repo = new InMemorySiteRepository();
    const useCase = new ConfigureSiteRulesUseCase({ siteRepository: repo });

    const result = await useCase.execute({
      siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
      tenantId: 'trama-demo',
      role: 'ADMIN',
      reglas: {
        horario: { inicio: '07:00', fin: '16:00', diasPermitidos: ['LUN', 'MAR', 'MIE'] },
        permisosRequeridos: ['CURSO_ALTURAS'],
        elementosProteccion: ['ARNES', 'LINEA_VIDA'],
      },
    });

    assert.ok(result.site);
    assert.strictEqual(result.reglas.horario.inicio, '07:00');
    assert.strictEqual(result.reglas.permisosRequeridos[0], 'CURSO_ALTURAS');
  });

  it('ConfigureSiteRulesUseCase debe denegar por defecto (ForbiddenError) cuando no se proporciona rol', async () => {
    const repo = new InMemorySiteRepository();
    const useCase = new ConfigureSiteRulesUseCase({ siteRepository: repo });

    await assert.rejects(
      async () => {
        await useCase.execute({
          siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
          tenantId: 'trama-demo',
          reglas: { horario: { inicio: '07:00', fin: '16:00', diasPermitidos: ['LUN'] } },
        });
      },
      (err) => err.code === 'FORBIDDEN' && err.statusCode === 403
    );
  });

  it('ConfigureSiteRulesUseCase debe fallar si la sede no existe o pertenece a otro tenant', async () => {
    const repo = new InMemorySiteRepository();
    const useCase = new ConfigureSiteRulesUseCase({ siteRepository: repo });

    await assert.rejects(
      async () => {
        await useCase.execute({
          siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
          tenantId: 'otro-tenant-invalido',
          reglas: {},
        });
      },
      /no encontrado/
    );
  });

  describe('GetSiteRulesForAllyUseCase: quién puede leer las reglas (SCRUM-853, criterio C2)', () => {
    const siteId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
    const crear = () =>
      new GetSiteRulesForAllyUseCase({
        siteRepository: new InMemorySiteRepository(),
        clientRepository: new InMemoryClientRepository(),
      });

    it('el cliente dueño de la sede recibe las reglas destacadas', async () => {
      const result = await crear().execute({ siteId, tenantId: 'trama-demo', userId: 'cliente-dueno-1', role: 'CLIENT' });

      assert.strictEqual(result.siteId, siteId);
      assert.strictEqual(result.tieneRestricciones, true);
      assert.ok(result.reglasDestacadas.totalRequisitos >= 1);
    });

    it('el admin del tenant recibe las reglas', async () => {
      const result = await crear().execute({ siteId, tenantId: 'trama-demo', userId: 'admin-1', role: 'ADMIN' });
      assert.strictEqual(result.siteId, siteId);
    });

    for (const [caso, input] of [
      ['otro cliente del tenant', { userId: 'cliente-ajeno', role: 'CLIENT' }],
      ['un aliado (la asignación aún no está en Core)', { userId: 'aliado-1', role: 'ALLY' }],
      ['sin rol', { userId: 'cliente-dueno-1' }],
    ]) {
      it(`${caso} recibe 403 sin datos`, async () => {
        await assert.rejects(
          () => crear().execute({ siteId, tenantId: 'trama-demo', ...input }),
          (err) => err instanceof ForbiddenError && err.statusCode === 403
        );
      });
    }

    it('una sede de otro tenant sigue respondiendo 404 antes de evaluar el rol', async () => {
      await assert.rejects(
        () => crear().execute({ siteId, tenantId: 'otro-tenant', userId: 'admin-1', role: 'ADMIN' }),
        /no encontrado/
      );
    });

    it('exige clientRepository para poder verificar al dueño', () => {
      assert.throws(() => new GetSiteRulesForAllyUseCase({ siteRepository: new InMemorySiteRepository() }), /clientRepository/);
    });
  });

  it('ValidateAllyScheduleUseCase aprueba dentro de horario y solicita justificación fuera de horario', async () => {
    const repo = new InMemorySiteRepository();
    const useCase = new ValidateAllyScheduleUseCase({ siteRepository: repo });

    // 1. Dentro de horario (Miércoles 10 am)
    const resAprobado = await useCase.execute({
      siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
      tenantId: 'trama-demo',
      fechaHoraPropuesta: '2026-10-14T10:00:00-05:00',
    });
    assert.strictEqual(resAprobado.estadoValidacion, 'APROBADO');

    // 2. Fuera de horario sin justificación (Miércoles 7 pm)
    const resRequerido = await useCase.execute({
      siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
      tenantId: 'trama-demo',
      fechaHoraPropuesta: '2026-10-14T19:00:00-05:00',
    });
    assert.strictEqual(resRequerido.estadoValidacion, 'REQUIERE_JUSTIFICACION');

    // 3. Fuera de horario con justificación válida
    const resJustificado = await useCase.execute({
      siteId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
      tenantId: 'trama-demo',
      fechaHoraPropuesta: '2026-10-14T19:00:00-05:00',
      justificacion: 'Reparación de tubería de emergencia con autorización de gerencia.',
    });
    assert.strictEqual(resJustificado.estadoValidacion, 'APROBADO_CON_JUSTIFICACION');
  });
});
