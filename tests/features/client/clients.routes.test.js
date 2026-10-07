const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');
const clientsRoutes = require('../../../src/features/client/presentation/clients.routes');

describe('Clients Presentation Layer - HTTP Endpoints (RF-08 / RF-09)', () => {
  let server;
  let baseUrl;

  before((t, done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/clients', clientsRoutes);
    app.use('/clientes', clientsRoutes);

    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((t, done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it('POST /api/v1/clients/company debe registrar empresa y sus sedes retornando 201 Created', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
        'X-Correlation-ID': 'test-http-corr-001',
      },
      body: JSON.stringify({
        razonSocial: 'Corporación Andina de Servicios S.A.',
        nit: '900333222-5',
        email: 'contacto@andinaservicios.co',
        telefono: '+57 320 1112233',
        nombreRepresentante: 'Gloria Stella Vargas',
        sitios: [
          {
            nombre: 'Sede Principal',
            direccion: 'Calle 72 # 10-34 Piso 4',
            zonaId: 'zona-bogota-norte',
            reglas: { horarioAcceso: '08:00 - 17:00' },
          },
          {
            nombre: 'Centro Logístico Occidente',
            direccion: 'Calle 13 # 98-50',
            zonaId: 'zona-bogota-occidente',
            reglas: { horarioAcceso: '24h', requiereEPI: true },
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.isNew, true);
    assert.strictEqual(data.client.tipo, 'EMPRESA');
    assert.strictEqual(data.client.razonSocial, 'Corporación Andina de Servicios S.A.');
    assert.strictEqual(data.sitios.length, 2);
    assert.strictEqual(data.correlationId, 'test-http-corr-001');
  });

  it('POST /clientes (alias) debe funcionar igual según especificación DD_V2', async () => {
    const res = await fetch(`${baseUrl}/clientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        razonSocial: 'Inversiones y Proyectos Alfa SAS',
        nit: '901888777-6',
        email: 'admin@alfa.com',
        sitios: [
          {
            nombre: 'Oficina Central',
            direccion: 'Carrera 9 # 113-52',
            zonaId: 'zona-bogota-usaquen',
          },
        ],
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.isNew, true);
    assert.strictEqual(data.sitios.length, 1);
  });

  it('POST /api/v1/clients/company debe responder 400 Bad Request si falta el header X-Tenant-Id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razonSocial: 'Empresa Sin Tenant',
        nit: '900000000-0',
        email: 'test@sintenant.com',
        sitios: [],
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /X-Tenant-Id es requerido/);
  });

  it('POST /api/v1/clients/company debe responder 400 si los datos son inválidos (nit corto, sin sitios válidos)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/clients/company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        razonSocial: 'E', // Demasiado corto
        nit: '1',         // Demasiado corto
        email: 'no-email',
      }),
    });

    assert.strictEqual(res.status, 400);
  });

  it('POST /api/v1/clients/:id/sites y GET /api/v1/clients/:id/sites flujo completo', async () => {
    // 1. Crear empresa
    const createRes = await fetch(`${baseUrl}/api/v1/clients/company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        razonSocial: 'Cadena de Hoteles Colombia S.A.',
        nit: '900777666-4',
        email: 'reservas@hotelesco.com',
        sitios: [
          {
            nombre: 'Hotel Chapinero',
            direccion: 'Carrera 7 # 60-15',
            zonaId: 'zona-bogota-chapinero',
          },
        ],
      }),
    });
    const createData = await createRes.json();
    const clientId = createData.client.id;

    // 2. Agregar nuevo sitio
    const addSiteRes = await fetch(`${baseUrl}/api/v1/clients/${clientId}/sites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-trama-1',
      },
      body: JSON.stringify({
        nombre: 'Hotel Parque 93',
        direccion: 'Calle 93B # 11A-84',
        zonaId: 'zona-bogota-chico',
        reglas: { horarioAcceso: '24h' },
      }),
    });
    assert.strictEqual(addSiteRes.status, 201);

    // 3. Consultar sitios
    const getSitesRes = await fetch(`${baseUrl}/api/v1/clients/${clientId}/sites`, {
      headers: {
        'X-Tenant-Id': 'tenant-trama-1',
      },
    });
    assert.strictEqual(getSitesRes.status, 200);
    const getSitesData = await getSitesRes.json();
    assert.strictEqual(getSitesData.totalSitios, 2);
    assert.strictEqual(getSitesData.sitios[0].nombre, 'Hotel Chapinero');
    assert.strictEqual(getSitesData.sitios[1].nombre, 'Hotel Parque 93');
  });
});
