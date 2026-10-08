const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signToken({ userId = 'user-empresa-1', tenantId = 'trama-demo', role = 'admin_tenant', expiresIn = '1h' } = {}) {
  return jwt.sign(
    {
      sub: userId,
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn }
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
    assert.strictEqual(res.body.client.tipo, 'PERSONA_JURIDICA');
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

  it('POST /api/v1/clients/company debe responder 409 Conflict si el NIT ya existe (sin exponer sedes, DoD §9.3)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    const payload = {
      razonSocial: 'Empresa Para Dup NIT S.A.S.',
      nit: '900888111-9',
      email: 'original@dup-nit.com',
      sitios: [{ direccion: 'Calle 1 # 2-3', zonaId: 'zona-1' }],
    };

    const res1 = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    assert.strictEqual(res1.status, 201);

    const res2 = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${token}`)
      .send({
        razonSocial: 'Intruso Que Pide Mismo NIT',
        nit: '900888111-9',
        email: 'intruso@dup-nit.com',
        sitios: [],
      });

    assert.strictEqual(res2.status, 409);
    assert.strictEqual(res2.body.code, 'NIT_ALREADY_REGISTERED');
    assert.strictEqual(res2.body.sitios, undefined);
  });

  it('RBAC: un usuario con rol ALIADO / ALLY recibe 403 Forbidden al intentar registrar empresas o gestionar sedes', async () => {
    const allyToken = signToken({ tenantId: 'trama-demo', role: 'aliado' });

    // 1. Intentar registrar empresa como aliado
    const regRes = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${allyToken}`)
      .send({
        razonSocial: 'Empresa Intento Aliado',
        nit: '900999888-1',
        email: 'aliado-intento@empresa.com',
        sitios: [],
      });
    assert.strictEqual(regRes.status, 403);
    assert.strictEqual(regRes.body.code, 'FORBIDDEN');

    // 2. Intentar agregar sede como aliado
    const addSiteRes = await request(app)
      .post('/api/v1/clients/any-id/sites')
      .set('Authorization', `Bearer ${allyToken}`)
      .send({ direccion: 'Calle 10 # 20-30', zonaId: 'zona-1' });
    assert.strictEqual(addSiteRes.status, 403);

    // 3. Intentar consultar sedes como aliado
    const getSitesRes = await request(app)
      .get('/api/v1/clients/any-id/sites')
      .set('Authorization', `Bearer ${allyToken}`);
    assert.strictEqual(getSitesRes.status, 403);
  });

  it('POST /api/v1/clients/:id/sites y GET /api/v1/clients/:id/sites con aislamiento cross-tenant estricto', async () => {
    const tokenTenantA = signToken({ tenantId: 'trama-demo', userId: 'user-dueno-hoteles' });
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

  it('Petición con token expirado responde 401 Unauthorized (Políticas §13.4)', async () => {
    const expiredToken = signToken({ expiresIn: -60 });
    const res = await request(app)
      .get('/api/v1/clients/any-id/sites')
      .set('Authorization', `Bearer ${expiredToken}`);

    assert.strictEqual(res.status, 401);
  });

  it('Otro cliente del mismo tenant recibe 403 Forbidden al consultar o agregar sitios a empresa ajena', async () => {
    const ownerToken = signToken({ userId: 'cliente-dueno-1', role: 'cliente', tenantId: 'trama-demo' });
    const otherClientToken = signToken({ userId: 'otro-cliente-ajeno', role: 'cliente', tenantId: 'trama-demo' });

    // 1. Crear empresa con el cliente dueño
    const createRes = await request(app)
      .post('/api/v1/clients/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        razonSocial: 'Empresa Privada Dueño 1 S.A.S.',
        nit: '900998877-1',
        email: 'dueno1@empresa.com',
        sitios: [
          {
            nombre: 'Sede Principal',
            direccion: 'Carrera 7 # 72-10',
            zonaId: 'zona-bogota-centro',
          },
        ],
      });

    assert.strictEqual(createRes.status, 201);
    const clienteId = createRes.body.client.id;

    // 2. Otro cliente del MISMO tenant intenta leer sedes -> Espera 403 Forbidden
    const getRes = await request(app)
      .get(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${otherClientToken}`);

    assert.strictEqual(getRes.status, 403);

    // 3. Otro cliente del MISMO tenant intenta agregar sedes -> Espera 403 Forbidden
    const postRes = await request(app)
      .post(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${otherClientToken}`)
      .send({
        nombre: 'Sede Infiltrada',
        direccion: 'Calle Intruso 456',
        zonaId: 'zona-bogota-centro',
      });

    assert.strictEqual(postRes.status, 403);
  });
});
