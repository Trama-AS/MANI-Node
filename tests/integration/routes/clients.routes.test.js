process.env.NODE_ENV = process.env.NODE_ENV || 'test';
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
          zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
          reglas: { tipoAcceso: 'peatonal_oficinas', requiereCarnet: true },
        },
        {
          nombre: 'Centro Logístico Fontibón',
          direccion: 'Carrera 100 # 24-55',
          zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
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

  it('los alias POST /clientes, POST /api/v1/clients y /clients/companies/:id/sites ya no existen (una ruta por operación)', async () => {
    const token = signToken({ tenantId: 'trama-demo' });

    for (const [method, ruta] of [
      ['post', '/clientes'],
      ['post', '/api/v1/clients'],
      ['get', '/api/v1/clients/companies/x/sites'],
      ['post', '/api/v1/clients/companies/x/sites'],
    ]) {
      const res = await request(app)[method](ruta).set('Authorization', `Bearer ${token}`).send({});
      assert.strictEqual(res.status, 404, `${method} ${ruta}`);
    }
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
      sitios: [{ direccion: 'Calle 1 # 2-3', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' }],
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
      .send({ direccion: 'Calle 10 # 20-30', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' });
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
            zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
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
        zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
      });

    assert.strictEqual(crossTenantPost.status, 404);

    // 4. Agregar sitio legítimo desde tenant-A -> Responde 201
    const addSiteRes = await request(app)
      .post(`/api/v1/clients/${clienteId}/sites`)
      .set('Authorization', `Bearer ${tokenTenantA}`)
      .send({
        nombre: 'Hotel Calle 100',
        direccion: 'Calle 100 # 8A-49',
        zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
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
            zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
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
        zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
      });

    assert.strictEqual(postRes.status, 403);
  });

  describe('PATCH /api/v1/clients/:id/sites/:siteId (SCRUM-1387 / CONS-16)', () => {
    const adminA = signToken({ tenantId: 'trama-demo', userId: 'admin-edicion-a' });
    const adminB = signToken({ tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userId: 'admin-edicion-b' });

    async function crearEmpresa(nit, email) {
      const res = await request(app)
        .post('/api/v1/clients/company')
        .set('Authorization', `Bearer ${adminA}`)
        .send({
          razonSocial: `Empresa ${nit} S.A.S.`,
          nit,
          email,
          sitios: [
            { nombre: 'Sede Norte', direccion: 'Calle 140 # 10-20', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' },
            { nombre: 'Sede Sur', direccion: 'Avenida 1 de Mayo # 40-10', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14' },
          ],
        });
      assert.strictEqual(res.status, 201);
      return { clienteId: res.body.client.id, sitios: res.body.sitios };
    }

    it('C1: edita una de las sedes y el cambio se ve al volver a consultar; la otra queda igual', async () => {
      const { clienteId, sitios } = await crearEmpresa('900700001-1', 'edicion1@empresa.com');

      const res = await request(app)
        .patch(`/api/v1/clients/${clienteId}/sites/${sitios[0].id}`)
        .set('Authorization', `Bearer ${adminA}`)
        .send({ nombre: 'Sede Norte Renovada', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', contactoNombre: 'Laura Gómez' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.sitio.id, sitios[0].id);
      assert.strictEqual(res.body.sitio.nombre, 'Sede Norte Renovada');
      assert.strictEqual(res.body.sitio.direccion, 'Calle 140 # 10-20');
      assert.ok(res.body.correlationId);

      const lista = await request(app)
        .get(`/api/v1/clients/${clienteId}/sites`)
        .set('Authorization', `Bearer ${adminA}`);
      assert.strictEqual(lista.status, 200);
      assert.strictEqual(lista.body.totalSitios, 2);
      const [norte, sur] = lista.body.sitios;
      assert.strictEqual(norte.nombre, 'Sede Norte Renovada');
      assert.strictEqual(norte.zonaId, 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15');
      assert.strictEqual(norte.contactoNombre, 'Laura Gómez');
      assert.strictEqual(sur.nombre, 'Sede Sur');
    });

    it('C2: sin zona o con un campo inválido responde 400 y la sede no cambia', async () => {
      const { clienteId, sitios } = await crearEmpresa('900700002-2', 'edicion2@empresa.com');
      const ruta = `/api/v1/clients/${clienteId}/sites/${sitios[0].id}`;

      for (const cuerpo of [{ zonaId: '' }, { direccion: 'x' }, { reglas: {} }, { tenantId: 'otro' }, {}]) {
        const res = await request(app).patch(ruta).set('Authorization', `Bearer ${adminA}`).send(cuerpo);
        assert.strictEqual(res.status, 400, JSON.stringify(cuerpo));
        assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
      }

      const lista = await request(app)
        .get(`/api/v1/clients/${clienteId}/sites`)
        .set('Authorization', `Bearer ${adminA}`);
      assert.strictEqual(lista.body.sitios[0].zonaId, 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13');
      assert.strictEqual(lista.body.sitios[0].direccion, 'Calle 140 # 10-20');
    });

    it('C3: el admin de otro tenant recibe 404 y la sede no cambia', async () => {
      const { clienteId, sitios } = await crearEmpresa('900700003-3', 'edicion3@empresa.com');

      const res = await request(app)
        .patch(`/api/v1/clients/${clienteId}/sites/${sitios[0].id}`)
        .set('Authorization', `Bearer ${adminB}`)
        .send({ nombre: 'Infiltrada' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.sitio, undefined);
      const lista = await request(app)
        .get(`/api/v1/clients/${clienteId}/sites`)
        .set('Authorization', `Bearer ${adminA}`);
      assert.strictEqual(lista.body.sitios[0].nombre, 'Sede Norte');
    });

    it('C3: la sede de otra empresa del mismo tenant no se edita por la ruta de esta empresa (404)', async () => {
      const empresa1 = await crearEmpresa('900700004-4', 'edicion4@empresa.com');
      const empresa2 = await crearEmpresa('900700005-5', 'edicion5@empresa.com');

      const res = await request(app)
        .patch(`/api/v1/clients/${empresa1.clienteId}/sites/${empresa2.sitios[0].id}`)
        .set('Authorization', `Bearer ${adminA}`)
        .send({ nombre: 'Cruzada' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.code, 'SITE_NOT_FOUND');
    });

    it('C4: otro cliente del mismo tenant recibe 403 y un aliado también', async () => {
      const { clienteId, sitios } = await crearEmpresa('900700006-6', 'edicion6@empresa.com');
      const ruta = `/api/v1/clients/${clienteId}/sites/${sitios[0].id}`;

      const otroCliente = signToken({ tenantId: 'trama-demo', userId: 'cliente-ajeno-edicion', role: 'cliente' });
      const aliado = signToken({ tenantId: 'trama-demo', userId: 'aliado-edicion', role: 'aliado' });

      const resCliente = await request(app).patch(ruta).set('Authorization', `Bearer ${otroCliente}`).send({ nombre: 'X' });
      assert.strictEqual(resCliente.status, 403);
      const resAliado = await request(app).patch(ruta).set('Authorization', `Bearer ${aliado}`).send({ nombre: 'X' });
      assert.strictEqual(resAliado.status, 403);
      assert.strictEqual(resAliado.body.code, 'FORBIDDEN');
    });

    it('sin token responde 401', async () => {
      const res = await request(app).patch('/api/v1/clients/c/sites/s').send({ nombre: 'X' });
      assert.strictEqual(res.status, 401);
    });
  });

  describe('Alias /clients/me/sites (SCRUM-1387)', () => {
    const container = require('../../../src/container');

    it('el cliente empresa lista, agrega y edita sus sedes con su JWT, sin conocer su id', async () => {
      const admin = signToken({ tenantId: 'trama-demo', userId: 'admin-alias-me' });
      const creada = await request(app)
        .post('/api/v1/clients/company')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          razonSocial: 'Empresa Alias Me S.A.S.',
          nit: '900700010-1',
          email: 'aliasme@empresa.com',
          sitios: [{ nombre: 'Sede Inicial', direccion: 'Calle 72 # 10-07', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' }],
        });
      assert.strictEqual(creada.status, 201);
      const cliente = await container.companyClientRepository.findById(creada.body.client.id, 'trama-demo');
      const dueno = signToken({ tenantId: 'trama-demo', userId: cliente.usuarioId, role: 'cliente' });

      const alta = await request(app)
        .post('/api/v1/clients/me/sites')
        .set('Authorization', `Bearer ${dueno}`)
        .send({ nombre: 'Sede Dos', direccion: 'Carrera 15 # 93-60', zonaId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' });
      assert.strictEqual(alta.status, 201);
      assert.strictEqual(alta.body.sitio.clienteId, cliente.id);

      const edicion = await request(app)
        .patch(`/api/v1/clients/me/sites/${alta.body.sitio.id}`)
        .set('Authorization', `Bearer ${dueno}`)
        .send({ nombre: 'Sede Dos Renombrada' });
      assert.strictEqual(edicion.status, 200);

      const lista = await request(app).get('/api/v1/clients/me/sites').set('Authorization', `Bearer ${dueno}`);
      assert.strictEqual(lista.status, 200);
      assert.strictEqual(lista.body.clienteId, cliente.id);
      assert.deepStrictEqual(
        lista.body.sitios.map((s) => s.nombre),
        ['Sede Inicial', 'Sede Dos Renombrada']
      );
    });

    it('un cliente sin empresa registrada recibe 404 con /clients/me/sites', async () => {
      const otro = signToken({ tenantId: 'trama-demo', userId: 'cliente-sin-empresa', role: 'cliente' });

      const res = await request(app).get('/api/v1/clients/me/sites').set('Authorization', `Bearer ${otro}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.code, 'CLIENT_NOT_FOUND');
    });
  });
});
