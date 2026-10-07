const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');
const clientsRoutes = require('../../../src/features/client/presentation/clients.routes');
const sitesRoutes = require('../../../src/features/client/presentation/sites.routes');

describe('Sites Presentation Layer - HTTP Endpoints (US-02.2.3 / RF-09)', () => {
  let server;
  let baseUrl;
  let siteId;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/clients', clientsRoutes);
    app.use('/api/v1/sites', sitesRoutes);
    app.use('/sitios', sitesRoutes);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Crear cliente y sitio previo para pruebas
    const res = await fetch(`${baseUrl}/api/v1/clients/company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        razonSocial: 'Complejo Industrial San Carlos S.A.S.',
        nit: '900222111-9',
        email: 'contacto@sancarlos.co',
        sitios: [
          {
            nombre: 'Sede Principal Bodegas',
            direccion: 'Avenida El Dorado # 100-20',
            zonaId: 'zona-bogota-occidente',
          },
        ],
      }),
    });
    const data = await res.json();
    siteId = data.sitios[0].id;
  });

  after((t, done) => {
    if (server) server.close(done);
    else done();
  });

  it('PATCH /api/v1/sites/:id/rules debe configurar reglas contextuales y responder 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/rules`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
        'X-Correlation-ID': 'test-rules-001',
      },
      body: JSON.stringify({
        horario: {
          inicio: '08:00',
          fin: '17:00',
          diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
        },
        permisosRequeridos: ['ARL_VIGENTE', 'CERTIFICADO_ALTURAS'],
        elementosProteccion: ['BOTAS_SEGURIDAD', 'CASCO'],
        instruccionesIngreso: 'Presentar cédula y planilla de aportes en portería.',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.sitioId, siteId);
    assert.strictEqual(data.reglas.horario.inicio, '08:00');
    assert.strictEqual(data.vistaAliado.totalRequisitos, 4);
  });

  it('GET /api/v1/sites/:id/rules (Scenario 1 / QS-06) expone reglas destacadas al aliado', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/rules`, {
      headers: {
        'X-Tenant-Id': 'tenant-trama-1',
      },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.tieneRestricciones, true);
    assert.strictEqual(data.reglasDestacadas.horarioAcceso.rango, '08:00 - 17:00');
    assert.deepStrictEqual(data.reglasDestacadas.permisosObligatorios, ['ARL_VIGENTE', 'CERTIFICADO_ALTURAS']);
    assert.deepStrictEqual(data.reglasDestacadas.elementosProteccionObligatorios, ['BOTAS_SEGURIDAD', 'CASCO']);
  });

  it('GET /sitios/:id/reglas (alias DD_V2) debe responder 200', async () => {
    const res = await fetch(`${baseUrl}/sitios/${siteId}/reglas`, {
      headers: {
        'X-Tenant-Id': 'tenant-trama-1',
      },
    });

    assert.strictEqual(res.status, 200);
  });

  it('POST /api/v1/sites/:id/validate-schedule (Scenario 2 BDD): agendar dentro de horario responde 200 APROBADO', async () => {
    // Miércoles 14 Oct a las 11:00 AM -> Dentro de horario
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/validate-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        fechaHoraPropuesta: '2026-10-14T11:00:00',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.estadoValidacion, 'APROBADO');
    assert.strictEqual(data.cumpleHorario, true);
    assert.strictEqual(data.requiereJustificacion, false);
  });

  it('POST /api/v1/sites/:id/validate-schedule (Scenario 2 BDD): agendar a las 19:00 sin justificación responde 422 REQUIERE_JUSTIFICACION', async () => {
    // Miércoles 14 Oct a las 19:00 PM -> Fuera de horario
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/validate-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        fechaHoraPropuesta: '2026-10-14T19:00:00',
      }),
    });

    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.estadoValidacion, 'REQUIERE_JUSTIFICACION');
    assert.strictEqual(data.requiereJustificacion, true);
    assert.ok(data.advertencia.includes('ADVERTENCIA: Agendamiento fuera de horario'));
  });

  it('POST /api/v1/sites/:id/validate-schedule: agendar fuera de horario CON justificación responde 200 APROBADO_CON_JUSTIFICACION', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/validate-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        fechaHoraPropuesta: '2026-10-14T19:00:00',
        justificacion: 'Reparación de tubería rota de emergencia acordada con supervisor',
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.estadoValidacion, 'APROBADO_CON_JUSTIFICACION');
    assert.strictEqual(data.justificacionAportada, 'Reparación de tubería rota de emergencia acordada con supervisor');
  });

  it('debe responder 400 si falta el header X-Tenant-Id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sites/${siteId}/rules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horario: { inicio: '08:00', fin: '17:00' } }),
    });

    assert.strictEqual(res.status, 400);
  });
});
