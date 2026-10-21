process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');

function signToken({ userId = 'user-test-1', tenantId = 'trama-demo', role = 'aliado' } = {}) {
  return jwt.sign(
    {
      sub: userId,
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

describe('Sites Presentation Layer - HTTP Endpoints (RF-09 / QS-06)', () => {
  const demoSiteId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';

  it('PATCH /api/v1/sites/:id/rules sin Authorization responde 401', async () => {
    const res = await request(app)
      .patch(`/api/v1/sites/${demoSiteId}/rules`)
      .send({ horario: { inicio: '08:00', fin: '17:00' } });

    assert.strictEqual(res.status, 401);
  });

  it('PATCH /api/v1/sites/:id/rules con token admin_tenant configura reglas retornando 200', async () => {
    const token = signToken({ tenantId: 'trama-demo', role: 'admin_tenant' });

    const payload = {
      horario: {
        inicio: '07:30',
        fin: '16:30',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
      permisosRequeridos: ['ARL_VIGENTE', 'TRABAJO_ALTURAS'],
      elementosProteccion: ['BOTAS_SEGURIDAD', 'CASCO', 'GAFAS'],
      instruccionesIngreso: 'Ingreso por portería vehicular carrera 15.',
      requiereAprobacionPrevia: true,
      contactoAcceso: { nombre: 'Jefe Seguridad', telefono: '3109998877' },
    };

    const res = await request(app)
      .patch(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.sitioId, demoSiteId);
    assert.strictEqual(res.body.reglas.horario.inicio, '07:30');
    assert.strictEqual(res.body.vistaAliado.totalRequisitos, 5);
  });

  it('PATCH /api/v1/sites/:id/rules con rol aliado responde 403 Forbidden (DoD §9.3)', async () => {
    const tokenAliado = signToken({ tenantId: 'trama-demo', role: 'aliado' });

    const res = await request(app)
      .patch(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${tokenAliado}`)
      .send({ horario: { inicio: '08:00', fin: '17:00' } });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
  });

  it('PATCH /api/v1/sites/:id/rules con cliente que no es dueño responde 403 Forbidden (DoD §9.3)', async () => {
    const tokenOtroCliente = signToken({
      tenantId: 'trama-demo',
      role: 'cliente',
      userId: 'cliente-ajeno-no-dueno',
    });

    const res = await request(app)
      .patch(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${tokenOtroCliente}`)
      .send({ horario: { inicio: '08:00', fin: '17:00' } });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
  });

  it('PATCH /api/v1/sites/:id/rules con cliente dueño de la sede responde 200 OK', async () => {
    const tokenDueno = signToken({
      tenantId: 'trama-demo',
      role: 'cliente',
      userId: 'cliente-dueno-1',
    });

    const res = await request(app)
      .patch(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${tokenDueno}`)
      .send({ horario: { inicio: '08:00', fin: '17:00' } });

    assert.strictEqual(res.status, 200);
  });

  it('GET /api/v1/sites/:id/rules sin Authorization responde 401', async () => {
    const res = await request(app).get(`/api/v1/sites/${demoSiteId}/rules`);
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/v1/sites/:id/rules con token de otro tenant responde 404 (Aislamiento cross-tenant)', async () => {
    const tokenTenantB = signToken({ tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });

    const res = await request(app)
      .get(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${tokenTenantB}`);

    assert.strictEqual(res.status, 404);
  });

  it('GET /api/v1/sites/:id/rules con el cliente dueño responde 200 con reglas destacadas (QS-06)', async () => {
    const token = signToken({ tenantId: 'trama-demo', role: 'cliente', userId: 'cliente-dueno-1' });

    const res = await request(app)
      .get(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.siteId, demoSiteId);
    assert.strictEqual(res.body.tieneRestricciones, true);
    assert.ok(res.body.reglasDestacadas.totalRequisitos >= 1);
  });

  it('GET /api/v1/sites/:id/rules con el admin del tenant responde 200', async () => {
    const token = signToken({ tenantId: 'trama-demo', role: 'admin_tenant', userId: 'admin-1' });

    const res = await request(app)
      .get(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.siteId, demoSiteId);
  });

  // Asignación del aliado: en la prueba, Dispatch se sustituye por un doble que responde según el JWT reenviado;
  // la solicitud asignada queda en el sitio demo del repositorio en memoria (Core es dueño del sitio de la solicitud).
  function conDispatch(asignacionesPorUsuario) {
    const useCase = container.getSiteRulesForAllyUseCase;
    const original = useCase.dispatchAssignmentService;
    useCase.dispatchAssignmentService = {
      async listMyAssignedRequestIds({ authorization }) {
        const { sub } = jwt.decode(String(authorization).replace(/^Bearer /, ''));
        return asignacionesPorUsuario[sub] || [];
      },
    };
    return () => {
      useCase.dispatchAssignmentService = original;
    };
  }

  it('GET /api/v1/sites/:id/rules con el aliado asignado a una solicitud del sitio responde 200 (criterio C1)', async () => {
    container.siteRepository.addRequest('sol-asignada-853', demoSiteId, 'trama-demo');
    const restaurar = conDispatch({ 'aliado-asignado-1': ['sol-asignada-853'] });
    try {
      const token = signToken({ tenantId: 'trama-demo', role: 'aliado', userId: 'aliado-asignado-1' });
      for (const ruta of ['rules', 'reglas']) {
        const res = await request(app)
          .get(`/api/v1/sites/${demoSiteId}/${ruta}`)
          .set('Authorization', `Bearer ${token}`);

        assert.strictEqual(res.status, 200, ruta);
        assert.strictEqual(res.body.siteId, demoSiteId);
        assert.ok(res.body.reglasDestacadas.totalRequisitos >= 1);
      }
    } finally {
      restaurar();
    }
  });

  it('GET /api/v1/sites/:id/rules responde 503 al aliado si Dispatch no está configurado (criterio T2)', async () => {
    const token = signToken({ tenantId: 'trama-demo', role: 'aliado', userId: 'aliado-asignado-1' });

    const res = await request(app)
      .get(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'DISPATCH_SERVICE_UNAVAILABLE');
    assert.strictEqual(res.body.reglasRaw, undefined);
  });

  for (const [caso, claims] of [
    ['un aliado no asignado', { role: 'aliado', userId: 'aliado-no-asignado-1' }],
    ['otro cliente del mismo tenant', { role: 'cliente', userId: 'cliente-ajeno-no-dueno' }],
  ]) {
    it(`GET /api/v1/sites/:id/rules con ${caso} responde 403 sin datos de la sede (criterio C2)`, async () => {
      const restaurar = conDispatch({});
      const token = signToken({ tenantId: 'trama-demo', ...claims });

      for (const ruta of ['rules', 'reglas']) {
        const res = await request(app)
          .get(`/api/v1/sites/${demoSiteId}/${ruta}`)
          .set('Authorization', `Bearer ${token}`);

        assert.strictEqual(res.status, 403, ruta);
        assert.strictEqual(res.body.code, 'FORBIDDEN');
        assert.strictEqual(res.body.reglasDestacadas, undefined);
        assert.strictEqual(res.body.reglasRaw, undefined);
        assert.strictEqual(res.body.direccion, undefined);
      }
      restaurar();
    });
  }

  it('POST /api/v1/sites/:id/validate-schedule valida horario dentro de rango (200)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    // Miércoles 10 am
    const res = await request(app)
      .post(`/api/v1/sites/${demoSiteId}/validate-schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHoraPropuesta: '2026-10-14T10:00:00-05:00' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estadoValidacion, 'APROBADO');
    assert.strictEqual(res.body.cumpleHorario, true);
  });

  it('POST /api/v1/sites/:id/validate-schedule fuera de rango sin justificación responde 422', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    // Miércoles 7 pm
    const res = await request(app)
      .post(`/api/v1/sites/${demoSiteId}/validate-schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHoraPropuesta: '2026-10-14T19:00:00-05:00' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.estadoValidacion, 'REQUIERE_JUSTIFICACION');
    assert.strictEqual(res.body.fueraDeHorario, true);
  });
});
