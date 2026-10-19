const test = require('node:test');
const assert = require('node:assert/strict');

const ListEligibleAlliesUseCase = require('../../../../src/application/useCases/dispatch/ListEligibleAlliesUseCase');
const GetSolicitudContextUseCase = require('../../../../src/application/useCases/dispatch/GetSolicitudContextUseCase');
const PublishNotificationUseCase = require('../../../../src/application/useCases/dispatch/PublishNotificationUseCase');
const ListNotificationsUseCase = require('../../../../src/application/useCases/dispatch/ListNotificationsUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const CATEGORIA = '33333333-3333-4333-8333-333333333333';
const ZONA = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY = '66666666-6666-4666-8666-666666666666';

const client = { userId: 'u1', tenantId: TENANT, role: 'CLIENT' };
const admin = { userId: 'u2', tenantId: TENANT, role: 'ADMIN' };
const ally = { userId: 'u3', tenantId: TENANT, role: 'ALLY' };

// ---- elegibilidad ----

function eligibleUseCase() {
  const calls = [];
  const useCase = new ListEligibleAlliesUseCase({
    elegibilidadRepository: {
      findEligible: async (criteria) => {
        calls.push(criteria);
        return { allies: [], totalCount: 0 };
      },
    },
  });
  return { useCase, calls };
}

test('elegibilidad: el tenant sale de la sesión y aplica valores por omisión de paginación', async () => {
  const { useCase, calls } = eligibleUseCase();

  await useCase.execute({ session: client, query: { categoriaId: CATEGORIA, zonaId: ZONA } });

  assert.deepEqual(calls[0], {
    tenantId: TENANT, categoriaId: CATEGORIA, zonaId: ZONA, requestId: undefined, tipo: undefined, page: 1, pageSize: 20,
  });
});

test('elegibilidad: normaliza el tipo y propaga requestId y paginación', async () => {
  const { useCase, calls } = eligibleUseCase();

  await useCase.execute({
    session: admin,
    query: { categoriaId: CATEGORIA, zonaId: ZONA, requestId: SOLICITUD, tipo: 'persona_juridica', page: '2', pageSize: '5' },
  });

  assert.equal(calls[0].tipo, 'PERSONA_JURIDICA');
  assert.equal(calls[0].requestId, SOLICITUD);
  assert.equal(calls[0].page, 2);
  assert.equal(calls[0].pageSize, 5);
});

test('elegibilidad: un aliado no puede consultarla (403)', async () => {
  const { useCase } = eligibleUseCase();

  await assert.rejects(
    () => useCase.execute({ session: ally, query: { categoriaId: CATEGORIA, zonaId: ZONA } }),
    (err) => err.statusCode === 403
  );
});

test('elegibilidad: una sesión sin tenant se rechaza (403)', async () => {
  const { useCase } = eligibleUseCase();

  await assert.rejects(
    () => useCase.execute({ session: { role: 'CLIENT' }, query: { categoriaId: CATEGORIA, zonaId: ZONA } }),
    (err) => err.statusCode === 403
  );
});

for (const [name, query] of [
  ['sin categoriaId', { zonaId: ZONA }],
  ['categoriaId no UUID', { categoriaId: 'x', zonaId: ZONA }],
  ['sin zonaId', { categoriaId: CATEGORIA }],
  ['requestId no UUID', { categoriaId: CATEGORIA, zonaId: ZONA, requestId: 'x' }],
  ['tipo desconocido', { categoriaId: CATEGORIA, zonaId: ZONA, tipo: 'EMPRESA' }],
  ['page cero', { categoriaId: CATEGORIA, zonaId: ZONA, page: '0' }],
  ['pageSize mayor al máximo', { categoriaId: CATEGORIA, zonaId: ZONA, pageSize: '101' }],
  ['pageSize no numérico', { categoriaId: CATEGORIA, zonaId: ZONA, pageSize: 'abc' }],
]) {
  test(`elegibilidad: ${name} responde 400`, async () => {
    const { useCase, calls } = eligibleUseCase();

    await assert.rejects(() => useCase.execute({ session: client, query }), (err) => err.statusCode === 400);
    assert.equal(calls.length, 0);
  });
}

test('elegibilidad: exige el repositorio', () => {
  assert.throws(() => new ListEligibleAlliesUseCase({}), /elegibilidadRepository/);
});

// ---- contexto de solicitud ----

test('contexto: devuelve la solicitud del tenant de la sesión', async () => {
  const seen = [];
  const useCase = new GetSolicitudContextUseCase({
    solicitudContextRepository: {
      findContext: async (tenantId, id) => {
        seen.push([tenantId, id]);
        return { id, tenantId, zonaId: ZONA, categoriaId: CATEGORIA, estado: 'PUBLICADA' };
      },
    },
  });

  const context = await useCase.execute({ session: client, solicitudId: SOLICITUD });

  assert.deepEqual(seen, [[TENANT, SOLICITUD]]);
  assert.equal(context.zonaId, ZONA);
});

test('contexto: solicitud inexistente o de otro tenant responde 404', async () => {
  const useCase = new GetSolicitudContextUseCase({ solicitudContextRepository: { findContext: async () => null } });

  await assert.rejects(() => useCase.execute({ session: client, solicitudId: SOLICITUD }), (err) => err.statusCode === 404);
});

test('contexto: id inválido responde 400 y un aliado 403', async () => {
  const useCase = new GetSolicitudContextUseCase({ solicitudContextRepository: { findContext: async () => null } });

  await assert.rejects(() => useCase.execute({ session: client, solicitudId: 'x' }), (err) => err.statusCode === 400);
  await assert.rejects(() => useCase.execute({ session: ally, solicitudId: SOLICITUD }), (err) => err.statusCode === 403);
});

// ---- publicar notificación ----

function publishUseCase(result = { id: 'n1' }) {
  const calls = [];
  const useCase = new PublishNotificationUseCase({
    notificacionRepository: { createForAlly: async (n) => { calls.push(n); return result; } },
  });
  return { useCase, calls };
}

const validBody = () => ({
  allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD, estado: 'ENVIADA' },
});

test('publicar: crea la notificación con el tenant de la sesión', async () => {
  const { useCase, calls } = publishUseCase();

  const created = await useCase.execute({ session: client, body: validBody() });

  assert.deepEqual(created, { id: 'n1' });
  assert.equal(calls[0].tenantId, TENANT);
  assert.equal(calls[0].allyId, ALLY);
});

test('publicar: un tenant distinto en el cuerpo es cross-tenant (403) y no escribe', async () => {
  const { useCase, calls } = publishUseCase();

  await assert.rejects(
    () => useCase.execute({ session: client, body: { ...validBody(), tenantId: OTHER_TENANT } }),
    (err) => err.statusCode === 403
  );
  assert.equal(calls.length, 0);
});

test('publicar: el mismo tenant en el cuerpo se acepta', async () => {
  const { useCase, calls } = publishUseCase();

  const created = await useCase.execute({ session: client, body: { ...validBody(), tenantId: TENANT } });

  assert.deepEqual(created, { id: 'n1' });
  assert.equal(calls.length, 1);
});

test('publicar: un aliado no puede publicar (403)', async () => {
  const { useCase } = publishUseCase();

  await assert.rejects(() => useCase.execute({ session: ally, body: validBody() }), (err) => err.statusCode === 403);
});

test('publicar: aliado inexistente en el tenant responde 404', async () => {
  const { useCase } = publishUseCase(null);

  await assert.rejects(() => useCase.execute({ session: client, body: validBody() }), (err) => err.statusCode === 404);
});

for (const [name, mutate] of [
  ['allyId no UUID', (b) => { b.allyId = 'x'; }],
  ['tipo no permitido', (b) => { b.tipo = 'OTRO'; }],
  ['canal no permitido', (b) => { b.canal = 'SMS'; }],
  ['payload ausente', (b) => { delete b.payload; }],
  ['payload arreglo', (b) => { b.payload = []; }],
  ['payload sin requestId', (b) => { b.payload = {}; }],
  ['payload.requestId no UUID', (b) => { b.payload = { requestId: 'x' }; }],
]) {
  test(`publicar: ${name} responde 400`, async () => {
    const { useCase, calls } = publishUseCase();
    const body = validBody();
    mutate(body);

    await assert.rejects(() => useCase.execute({ session: client, body }), (err) => err.statusCode === 400);
    assert.equal(calls.length, 0);
  });
}

test('publicar: exige el repositorio', () => {
  assert.throws(() => new PublishNotificationUseCase({}), /notificacionRepository/);
});

// ---- listar notificaciones ----

test('listar: devuelve los payloads con timestamp de envío cuando falta', async () => {
  const sent = new Date('2026-10-18T10:00:00.000Z');
  const seen = [];
  const useCase = new ListNotificationsUseCase({
    notificacionRepository: {
      listByRequest: async (...args) => {
        seen.push(args);
        return [
          { payload: { requestId: SOLICITUD, allyId: ALLY }, enviadoAt: sent },
          { payload: { requestId: SOLICITUD, allyId: OTHER_TENANT, timestamp: 'propio' }, enviadoAt: sent },
        ];
      },
    },
  });

  const offers = await useCase.execute({ session: admin, query: { requestId: SOLICITUD } });

  assert.deepEqual(seen, [[TENANT, SOLICITUD, 'OFERTA_DESPACHO']]);
  assert.equal(offers[0].timestamp, '2026-10-18T10:00:00.000Z');
  assert.equal(offers[1].timestamp, 'propio');
});

test('listar: requestId inválido 400, tipo distinto 400 y aliado 403', async () => {
  const useCase = new ListNotificationsUseCase({ notificacionRepository: { listByRequest: async () => [] } });

  await assert.rejects(() => useCase.execute({ session: client, query: { requestId: 'x' } }), (err) => err.statusCode === 400);
  await assert.rejects(
    () => useCase.execute({ session: client, query: { requestId: SOLICITUD, tipo: 'OTRO' } }),
    (err) => err.statusCode === 400
  );
  await assert.rejects(() => useCase.execute({ session: ally, query: { requestId: SOLICITUD } }), (err) => err.statusCode === 403);
});

test('listar: exige el repositorio', () => {
  assert.throws(() => new ListNotificationsUseCase({}), /notificacionRepository/);
});

// ---- perfil del aliado autenticado ----

const GetOwnAllyProfileUseCase = require('../../../../src/application/useCases/dispatch/GetOwnAllyProfileUseCase');

function allyProfileUseCase(aliado) {
  const calls = [];
  const useCase = new GetOwnAllyProfileUseCase({
    aliadoRepository: { findByUsuarioId: async (...args) => { calls.push(args); return aliado; } },
  });
  return { useCase, calls };
}

test('perfil de aliado: busca por el tenant y el usuario del JWT y devuelve el estado canónico (Supabase)', async () => {
  const { useCase, calls } = allyProfileUseCase({
    id: ALLY, tenant_id: TENANT, usuario_id: 'u3', estado_verificacion: 'VERIFICADO',
  });

  const profile = await useCase.execute({ session: ally });

  assert.deepEqual(calls, [[TENANT, 'u3']]);
  assert.deepEqual(profile, { id: ALLY, tenantId: TENANT, usuarioId: 'u3', estadoVerificacion: 'VERIFICADO' });
});

test('perfil de aliado: traduce el literal del dominio (en memoria) al canónico', async () => {
  const { useCase } = allyProfileUseCase({ id: ALLY, tenantId: TENANT, usuarioId: 'u3', estadoVerificacion: 'VERIFIED' });

  const profile = await useCase.execute({ session: ally });

  assert.equal(profile.estadoVerificacion, 'VERIFICADO');
});

test('perfil de aliado: un aliado pendiente se devuelve como PENDIENTE (Dispatch decide)', async () => {
  const { useCase } = allyProfileUseCase({ id: ALLY, tenant_id: TENANT, usuario_id: 'u3', estado_verificacion: 'PENDIENTE' });

  assert.equal((await useCase.execute({ session: ally })).estadoVerificacion, 'PENDIENTE');
});

test('perfil de aliado: sin fila responde 404; un cliente, un admin o sin tenant responden 403', async () => {
  const { useCase } = allyProfileUseCase(null);

  await assert.rejects(() => useCase.execute({ session: ally }), (err) => err.statusCode === 404);
  await assert.rejects(() => useCase.execute({ session: client }), (err) => err.statusCode === 403);
  await assert.rejects(() => useCase.execute({ session: admin }), (err) => err.statusCode === 403);
  await assert.rejects(() => useCase.execute({ session: { userId: 'u', role: 'ALLY' } }), (err) => err.statusCode === 403);
  await assert.rejects(() => useCase.execute({}), (err) => err.statusCode === 403);
});

test('perfil de aliado: exige el repositorio', () => {
  assert.throws(() => new GetOwnAllyProfileUseCase({}), /aliadoRepository/);
});
