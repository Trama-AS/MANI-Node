const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const InMemorySiteRepository = require('../../../../src/infrastructure/repositories/InMemorySiteRepository');
const InMemoryClientRepository = require('../../../../src/infrastructure/repositories/InMemoryClientRepository');
const { ForbiddenError, DomainError } = require('../../../../src/domain/errors/DomainError');
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

  describe('GetSiteRulesForAllyUseCase: quién puede leer las reglas (SCRUM-853, criterios C1, C2, C5, T1 y T2)', () => {
    const siteId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
    const otroSitio = 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99';

    // Doble de Dispatch: devuelve las solicitudes asignadas al aliado cuyo token se reenvía.
    function fakeDispatch(asignacionesPorToken = {}) {
      const llamadas = [];
      return {
        llamadas,
        async listMyAssignedRequestIds({ authorization, correlationId }) {
          llamadas.push({ authorization, correlationId });
          return asignacionesPorToken[authorization] || [];
        },
      };
    }

    const crear = ({ dispatch = fakeDispatch(), siteRepository = new InMemorySiteRepository() } = {}) =>
      new GetSiteRulesForAllyUseCase({
        siteRepository,
        clientRepository: new InMemoryClientRepository(),
        dispatchAssignmentService: dispatch,
      });

    it('C1: el aliado con una solicitud asignada en el sitio recibe las reglas', async () => {
      const sitios = new InMemorySiteRepository();
      sitios.addRequest('sol-1', siteId, 'trama-demo');
      const dispatch = fakeDispatch({ 'Bearer aliado-1': ['sol-1'] });

      const result = await crear({ dispatch, siteRepository: sitios }).execute({
        siteId,
        tenantId: 'trama-demo',
        userId: 'aliado-1',
        role: 'ALLY',
        authorization: 'Bearer aliado-1',
        correlationId: 'corr-1',
      });

      assert.strictEqual(result.siteId, siteId);
      assert.ok(result.reglasDestacadas.totalRequisitos >= 1);
      assert.deepEqual(dispatch.llamadas, [{ authorization: 'Bearer aliado-1', correlationId: 'corr-1' }], 'reenvía el JWT del aliado');
    });

    it('C2: el aliado sin asignaciones, o asignado solo en otro sitio, recibe 403 sin datos', async () => {
      const sitios = new InMemorySiteRepository();
      sitios.addRequest('sol-otro-sitio', otroSitio, 'trama-demo');
      const dispatch = fakeDispatch({ 'Bearer en-otro-sitio': ['sol-otro-sitio'] });

      for (const authorization of ['Bearer sin-asignaciones', 'Bearer en-otro-sitio']) {
        await assert.rejects(
          () => crear({ dispatch, siteRepository: sitios }).execute({ siteId, tenantId: 'trama-demo', role: 'ALLY', authorization }),
          (err) => err instanceof ForbiddenError && err.statusCode === 403,
          authorization
        );
      }
    });

    it('C5: si la solicitud pasa a otro sitio, el aliado deja de leer las reglas del anterior y lee las del nuevo', async () => {
      const sitios = new InMemorySiteRepository();
      await sitios.create({ id: otroSitio, tenantId: 'trama-demo', direccion: 'Carrera 7 # 20-30', zonaId: 'zona-centro' });
      const dispatch = fakeDispatch({ 'Bearer aliado-1': ['sol-1'] });
      sitios.addRequest('sol-1', otroSitio, 'trama-demo');
      const useCase = crear({ dispatch, siteRepository: sitios });

      await assert.rejects(
        () => useCase.execute({ siteId, tenantId: 'trama-demo', role: 'ALLY', authorization: 'Bearer aliado-1' }),
        (err) => err.statusCode === 403
      );
      const nuevo = await useCase.execute({ siteId: otroSitio, tenantId: 'trama-demo', role: 'ALLY', authorization: 'Bearer aliado-1' });
      assert.strictEqual(nuevo.siteId, otroSitio);
    });

    it('T2: si Dispatch no responde, el aliado recibe 503 y no se decide con datos locales', async () => {
      const dispatch = {
        async listMyAssignedRequestIds() {
          throw new DomainError('El servicio de despacho no está disponible: sin respuesta', 'DISPATCH_SERVICE_UNAVAILABLE', 503);
        },
      };

      await assert.rejects(
        () => crear({ dispatch }).execute({ siteId, tenantId: 'trama-demo', role: 'ALLY', authorization: 'Bearer aliado-1' }),
        (err) => err.statusCode === 503 && err.code === 'DISPATCH_SERVICE_UNAVAILABLE'
      );
    });

    it('el dueño y el admin no dependen de Dispatch', async () => {
      const dispatch = fakeDispatch();
      await crear({ dispatch }).execute({ siteId, tenantId: 'trama-demo', userId: 'cliente-dueno-1', role: 'CLIENT' });
      await crear({ dispatch }).execute({ siteId, tenantId: 'trama-demo', userId: 'admin-1', role: 'ADMIN' });
      assert.strictEqual(dispatch.llamadas.length, 0);
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

    it('exige clientRepository y dispatchAssignmentService', () => {
      assert.throws(() => new GetSiteRulesForAllyUseCase({ siteRepository: new InMemorySiteRepository() }), /clientRepository/);
      assert.throws(
        () => new GetSiteRulesForAllyUseCase({ siteRepository: new InMemorySiteRepository(), clientRepository: new InMemoryClientRepository() }),
        /dispatchAssignmentService/
      );
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
