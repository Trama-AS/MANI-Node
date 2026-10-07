const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signToken({ userId = 'user-empresa-1', tenantId = 'trama-demo', role = 'cliente' } = {}) {
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

describe('Clients Presentation Layer - HTTP Endpoints (RF-08 / RF-09)', () => {
  it('POST /api/v1/clients/company sin Authorization responde 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/clients/company')
      .send({
        razonSocial: 'Empresa Sin Token S.A.S.',
        nit: '900111222-1',
        email: 'sintoken@empresa.com',
      });

    assert.strictEqual(res.status, 401);
  });

  it('POST /api/v1/clients/company con token registra empresa y sedes retornando 201 Created', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    const payload = {
      razonSocial: 'Corporación Andina de Servicios S.A.',
      nit: '901234567-9',
      email: 'contacto@corp-andina.com',
      telefono: '6013456789',
      nombreRepresentante: 'Diana Marcela Torres',
      sitios: [
        {
          nombre: 'Sede Administrativa Salitre',
          direccion: 'Avenida El Dorado # 69-76, Torre 3',
          zonaId: 'zona-bogota-salitre',
          reglas: { tipoAcceso: 'peatonal_oficinas', requiereCarnet: true },
        },
        {
          nombre: 'Centro Logístico Fontibón',
          direccion: 'Carrera 100 # 24-55',
          zonaId: 'zona-bogota-occidente',
          reglas: { tipoAcceso: 'muelle_pesado', requiereEpi: true },
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.isNew, true);
    assert.strictEqual(res.body.tenantId, 'trama-demo');
    assert.strictEqual(res.body.client.razonSocial, 'Corporación Andina de Servicios S.A.');
    assert.strictEqual(res.body.client.nit, '901234567-9');
    assert.strictEqual(res.body.client.tipo, 'EMPRESA');
    assert.strictEqual(res.body.sitios.length, 2);
    assert.strictEqual(res.body.sitios[0].nombre, 'Sede Administrativa Salitre');
    assert.strictEqual(res.body.sitios[1].nombre, 'Centro Logístico Fontibón');
  });

  it('POST /clientes (alias) funciona igual con token válido', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    const payload = {
      razonSocial: 'Inversiones y Proyectos Alfa SAS',
      nit: '900333444-2',
      email: 'proyectos@alfa.com',
      sitios: [
        {
          nombre: 'Edificio Alfa',
          direccion: 'Calle 72 # 10-34',
          zonaId: 'zona-bogota-centro',
        },
      ],
    };

    const res = await request(app)
      .post('/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.client.razonSocial, 'Inversiones y Proyectos Alfa SAS');
  });

  it('POST /api/v1/clients/company debe responder 400 si los datos son inválidos (nit corto, sin sitios válidos)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    const payloadInvalido = {
      razonSocial: 'A', // Demasiado corto
      nit: '12',        // Demasiado corto
      email: 'no-es-un-correo',
      sitios: [
        {
          direccion: 'Dir', // Demasiado corta
          zonaId: '',       // Falta zonaId obligatoria
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${token}`)
      .send(payloadInvalido);

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('POST /api/v1/clients/:id/sites y GET /api/v1/clients/:id/sites con aislamiento cross-tenant estricto', async () => {
    const tokenTenantA = signToken({ tenantId: 'trama-demo' });
    const tokenTenantB = signToken({ tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });

    // 1. Registrar empresa en tenant-A
    const createRes = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${tokenTenantA}`)
      .send({
        razonSocial: 'Cadena de Hoteles Colombia S.A.',
        nit: '900456789-5',
        email: 'hoteles@colombia.com',
        sitios: [
          {
            nombre: 'Hotel Parque 93',
            direccion: 'Calle 93 # 12-40',
            zonaId: 'zona-bogota-norte',
          },
        ],
      });

    assert.strictEqual(createRes.status, 201);
    const clienteId = createRes.body.client.id;

    // 2. Intentar leer desde tenant-B -> Debe responder 404 (Protección contra lectura cross-tenant)
    const crossTenantGet = await request(app)
      .get(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${tokenTenantB}`);

    assert.strictEqual(crossTenantGet.status, 404);

    // 3. Intentar agregar sitio desde tenant-B -> Debe responder 404 (Protección contra escritura cross-tenant)
    const crossTenantPost = await request(app)
      .post(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${tokenTenantB}`)
      .send({
        nombre: 'Sitio Infiltrado',
        direccion: 'Calle Falsa 123',
        zonaId: 'zona-1',
      });

    assert.strictEqual(crossTenantPost.status, 404);

    // 4. Agregar sitio legítimo desde tenant-A -> Responde 201
    const addSiteRes = await request(app)
      .post(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${tokenTenantA}`)
      .send({
        nombre: 'Hotel Calle 100',
        direccion: 'Calle 100 # 8A-49',
        zonaId: 'zona-bogota-norte',
        reglas: { recepcion24h: true },
      });

    assert.strictEqual(addSiteRes.status, 201);
    assert.strictEqual(addSiteRes.body.sitio.nombre, 'Hotel Calle 100');

    // 5. Consultar sitios legítimos desde tenant-A -> Responde 200 con 2 sitios
    const getSitesRes = await request(app)
      .get(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${tokenTenantA}`);

    assert.strictEqual(getSitesRes.status, 200);
    assert.strictEqual(getSitesRes.body.totalSitios, 2);
    assert.strictEqual(getSitesRes.body.sitios[0].nombre, 'Hotel Parque 93');
    assert.strictEqual(getSitesRes.body.sitios[1].nombre, 'Hotel Calle 100');
  });
});
