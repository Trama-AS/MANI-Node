process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const CreateServiceRequestUseCase = require('../../../src/application/useCases/requests/CreateServiceRequestUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const SITIO = '55555555-5555-4555-8555-555555555555';
const descripcion = 'Fuga de agua en el baño principal desde ayer';

function token({ role = 'cliente', sub = USER, tenantId = TENANT, secret = config.supabaseJwtSecret, expiresIn = '1h' } = {}) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, secret, { algorithm: 'HS256', expiresIn });
}

function conRepositorio(crear, fn) {
  return async () => {
    const original = container.createServiceRequestUseCase;
    container.createServiceRequestUseCase = new CreateServiceRequestUseCase({
      serviceRequestRepository: { crear },
      fileStorageService: { upload: async ({ path }) => ({ path }), delete: async () => {} },
    });
    try {
      await fn();
    } finally {
      container.createServiceRequestUseCase = original;
    }
  };
}

test('POST /solicitudes sin token, con token expirado o firmado con otro secreto responde 401', async () => {
  for (const auth of [null, token({ expiresIn: -60 }), token({ secret: 'otro-secreto' })]) {
    const req = request(app).post('/api/v1/solicitudes');
    if (auth) req.set('Authorization', `Bearer ${auth}`);
    const res = await req.send({ categoriaId: CAT, descripcion, sitioId: SITIO });
    assert.equal(res.status, 401);
  }
});

test('POST /solicitudes con rol aliado responde 403', async () => {
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token({ role: 'aliado' })}`).send({ categoriaId: CAT, descripcion, sitioId: SITIO });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-SOL-403C');
});

test('POST /solicitudes con datos inválidos responde 422 con el código MANI-SOL', async () => {
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token()}`).send({ categoriaId: CAT, descripcion: 'corta', sitioId: SITIO });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-SOL-422D');
});

test('POST /solicitudes multipart con fotos: 201 y el repositorio recibe el tenant del token y las rutas subidas', conRepositorio(
  async (ctx, datos) => ({ solicitud: { id: 'sol-1', estado: 'PENDIENTE', tenant: ctx.tenantId, fotos: datos.fotos.length }, creada: true }),
  async () => {
    const res = await request(app)
      .post('/api/v1/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
      .field('categoriaId', CAT)
      .field('descripcion', descripcion)
      .field('sitioId', SITIO)
      .attach('fotos', Buffer.from('a'), { filename: 'a.png', contentType: 'image/png' })
      .attach('fotos', Buffer.from('b'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    assert.equal(res.status, 201);
    assert.equal(res.body.solicitud.estado, 'PENDIENTE');
    assert.equal(res.body.solicitud.tenant, TENANT);
    assert.equal(res.body.solicitud.fotos, 2);
  }
));

test('POST /solicitudes con la misma clave de idempotencia responde 200 con la solicitud existente', conRepositorio(
  async () => ({ solicitud: { id: 'sol-previa' }, creada: false }),
  async () => {
    const res = await request(app)
      .post('/api/v1/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ categoriaId: CAT, descripcion, sitioId: SITIO, claveIdempotencia: '66666666-6666-4666-8666-666666666666' });

    assert.equal(res.status, 200);
    assert.equal(res.body.solicitud.id, 'sol-previa');
  }
));

test('sin DATABASE_URL la creación falla cerrado con 503', async (t) => {
  if (container.pgPoolFactory.isConfigured()) {
    t.skip('DATABASE_URL está configurada');
    return;
  }
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token()}`).send({ categoriaId: CAT, descripcion, sitioId: SITIO });

  assert.equal(res.status, 503);
});

// HU-M07-04 (SCRUM-871): seguimiento del cliente por el Gateway.
const ConsultOwnServiceRequestsUseCase = require('../../../src/application/useCases/requests/ConsultOwnServiceRequestsUseCase');
const SOL = '44444444-4444-4444-8444-444444444444';

function conSeguimiento(repo, fn) {
  return async () => {
    const original = container.consultOwnServiceRequestsUseCase;
    container.consultOwnServiceRequestsUseCase = new ConsultOwnServiceRequestsUseCase({ serviceRequestRepository: repo });
    try {
      await fn();
    } finally {
      container.consultOwnServiceRequestsUseCase = original;
    }
  };
}

test('GET /solicitudes/me sin token o con token expirado responde 401', async () => {
  for (const auth of [null, token({ expiresIn: -60 })]) {
    const req = request(app).get('/api/v1/solicitudes/me');
    if (auth) req.set('Authorization', `Bearer ${auth}`);
    assert.equal((await req).status, 401);
  }
});

test('GET /solicitudes/me con rol aliado responde 403 MANI-SOL-403C', async () => {
  const res = await request(app).get('/api/v1/solicitudes/me').set('Authorization', `Bearer ${token({ role: 'aliado' })}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-SOL-403C');
});

test('GET /solicitudes/me lista con el tenant y el usuario del token, ignorando cabeceras del cliente', conSeguimiento(
  {
    listarDelCliente: async (ctx) => [{ id: SOL, estado: 'PENDIENTE', tenant: ctx.tenantId, usuario: ctx.userId }],
  },
  async () => {
    const res = await request(app)
      .get('/api/v1/solicitudes/me')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.solicitudes, [{ id: SOL, estado: 'PENDIENTE', tenant: TENANT, usuario: USER }]);
  }
));

test('GET /solicitudes/me/:id devuelve la solicitud propia', conSeguimiento(
  { obtenerDelCliente: async (_ctx, id) => ({ id, estado: 'ASIGNADA', zonaDeclarada: { nombre: 'Chapinero' } }) },
  async () => {
    const res = await request(app).get(`/api/v1/solicitudes/me/${SOL}`).set('Authorization', `Bearer ${token()}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.solicitud.id, SOL);
    assert.equal(res.body.solicitud.zonaDeclarada.nombre, 'Chapinero');
  }
));

test('GET /solicitudes/me/:id ajena o inexistente responde 404 y un id inválido 400', conSeguimiento(
  { obtenerDelCliente: async () => null },
  async () => {
    const ajena = await request(app).get(`/api/v1/solicitudes/me/${SOL}`).set('Authorization', `Bearer ${token()}`);
    assert.equal(ajena.status, 404);
    assert.equal(ajena.body.code, 'MANI-SOL-404');

    const invalida = await request(app).get('/api/v1/solicitudes/me/no-es-uuid').set('Authorization', `Bearer ${token()}`);
    assert.equal(invalida.status, 400);
    assert.equal(invalida.body.code, 'MANI-SOL-400');
  }
));

test('GET /solicitudes/me no tapa la ruta de contexto de Dispatch', async () => {
  const res = await request(app).get(`/api/v1/solicitudes/${SOL}/context`);

  assert.equal(res.status, 401);
});

// US-04.5.1 (SCRUM-877): el cliente cancela su solicitud antes de la ejecución.
const CancelServiceRequestUseCase = require('../../../src/application/useCases/requests/CancelServiceRequestUseCase');
const rutaCancelar = (id = SOL) => `/api/v1/solicitudes/me/${id}/cancelar`;

function conCancelacion(cancelar, fn) {
  return async () => {
    const original = container.cancelServiceRequestUseCase;
    container.cancelServiceRequestUseCase = new CancelServiceRequestUseCase({ serviceRequestRepository: { cancelar } });
    try {
      await fn();
    } finally {
      container.cancelServiceRequestUseCase = original;
    }
  };
}

test('PATCH /solicitudes/me/:id/cancelar sin token, expirado o firmado con otro secreto responde 401', async () => {
  for (const auth of [null, token({ expiresIn: -60 }), token({ secret: 'otro-secreto' })]) {
    const req = request(app).patch(rutaCancelar());
    if (auth) req.set('Authorization', `Bearer ${auth}`);
    assert.equal((await req.send({})).status, 401);
  }
});

test('PATCH /solicitudes/me/:id/cancelar con rol aliado o admin responde 403 MANI-SOL-403C', async () => {
  for (const role of ['aliado', 'admin_tenant']) {
    const res = await request(app).patch(rutaCancelar()).set('Authorization', `Bearer ${token({ role })}`).send({});
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'MANI-SOL-403C');
  }
});

test('PATCH /solicitudes/me/:id/cancelar con id inválido responde 400 y con motivo largo 422', async () => {
  const invalida = await request(app).patch(rutaCancelar('no-es-uuid')).set('Authorization', `Bearer ${token()}`).send({});
  assert.equal(invalida.status, 400);
  assert.equal(invalida.body.code, 'MANI-SOL-400');

  const larga = await request(app).patch(rutaCancelar()).set('Authorization', `Bearer ${token()}`).send({ motivo: 'x'.repeat(201) });
  assert.equal(larga.status, 422);
  assert.equal(larga.body.code, 'MANI-SOL-422M');
});

test('PATCH /solicitudes/me/:id/cancelar responde 200 con la solicitud cancelada y usa el tenant del token, no el del cliente', conCancelacion(
  async (ctx, datos) => ({ solicitud: { id: datos.solicitudId, estado: 'CANCELADA', tenant: ctx.tenantId, usuario: ctx.userId }, cancelada: true }),
  async () => {
    const res = await request(app)
      .patch(rutaCancelar())
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
      .send({ motivo: 'Ya no lo necesito', tenantId: '99999999-9999-4999-8999-999999999999' });

    assert.equal(res.status, 200);
    assert.equal(res.body.cancelada, true);
    assert.deepEqual(res.body.solicitud, { id: SOL, estado: 'CANCELADA', tenant: TENANT, usuario: USER });
  }
));

test('PATCH /solicitudes/me/:id/cancelar repetido responde 200 con cancelada=false', conCancelacion(
  async () => ({ solicitud: { id: SOL, estado: 'CANCELADA' }, cancelada: false }),
  async () => {
    const res = await request(app).patch(rutaCancelar()).set('Authorization', `Bearer ${token()}`).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.cancelada, false);
  }
));

test('PATCH /solicitudes/me/:id/cancelar propaga 404 de una ajena y 409 de una en ejecución con el formato de error único', async () => {
  const { NotFoundError, ConflictError } = require('../../../src/domain/errors/DomainError');
  for (const [error, status, code] of [
    [new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404'), 404, 'MANI-SOL-404'],
    [new ConflictError('MANI-SOL-409C: una solicitud EN_EJECUCION ya no se puede cancelar', 'MANI-SOL-409C'), 409, 'MANI-SOL-409C'],
  ]) {
    await conCancelacion(async () => { throw error; }, async () => {
      const res = await request(app).patch(rutaCancelar()).set('Authorization', `Bearer ${token()}`).send({});
      assert.equal(res.status, status);
      assert.equal(res.body.code, code);
      assert.ok(res.body.error && res.body.correlationId);
    })();
  }
});

test('sin DATABASE_URL la cancelación falla cerrado con 503', async (t) => {
  if (container.pgPoolFactory.isConfigured()) {
    t.skip('DATABASE_URL está configurada');
    return;
  }
  const res = await request(app).patch(rutaCancelar()).set('Authorization', `Bearer ${token()}`).send({});
  assert.equal(res.status, 503);
});
