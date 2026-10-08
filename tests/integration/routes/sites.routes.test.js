const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

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

  it('PATCH /api/v1/sites/:id/rules con token configura reglas retornando 200', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

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

  it('GET /api/v1/sites/:id/rules con token del tenant responde 200 con reglas destacadas (QS-06)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    const res = await request(app)
      .get(`/api/v1/sites/${demoSiteId}/rules`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.siteId, demoSiteId);
    assert.strictEqual(res.body.tieneRestricciones, true);
    assert.ok(res.body.reglasDestacadas.totalRequisitos >= 1);
  });

  it('POST /api/v1/sites/:id/validate-schedule valida horario dentro de rango (200)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    // Miércoles 10 am
    const res = await request(app)
      .post(`/api/v1/sites/${demoSiteId}/validate-schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaHoraPropuesta: '2026-10-14T10:00:00' });

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
      .send({ fechaHoraPropuesta: '2026-10-14T19:00:00' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.estadoValidacion, 'REQUIERE_JUSTIFICACION');
    assert.strictEqual(res.body.fueraDeHorario, true);
  });
});
