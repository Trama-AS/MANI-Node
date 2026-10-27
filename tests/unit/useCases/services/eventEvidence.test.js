const test = require('node:test');
const assert = require('node:assert/strict');
const ServiceEventsUseCase = require('../../../../src/application/useCases/services/ServiceEventsUseCase');
const PgServiceEventRepository = require('../../../../src/infrastructure/repositories/PgServiceEventRepository');
const InMemoryFileStorageService = require('../../../../src/infrastructure/security/InMemoryFileStorageService');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const EVENTO = '66666666-6666-4666-8666-666666666666';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function useCase(ruta = `${TENANT}/u/eventos/${SOLICITUD}/f.png`) {
  const firmas = [];
  const calls = [];
  const uc = new ServiceEventsUseCase({
    serviceEventRepository: {
      rutaEvidencia: async (ctx, solicitudId, eventoId) => {
        calls.push({ ctx, solicitudId, eventoId });
        return ruta;
      },
    },
    fileStorageService: {
      createSignedUrl: async (path, segundos, opciones) => {
        firmas.push({ path, segundos, opciones });
        return { signedUrl: `https://firmada/${path}`, expiresIn: segundos };
      },
    },
  });
  return { uc, firmas, calls };
}

test('SCRUM-870: el cliente obtiene una URL firmada de 5 minutos en el bucket solicitudes', async () => {
  const { uc, firmas, calls } = useCase();
  const r = await uc.evidencia({ user: cliente, solicitudId: SOLICITUD, eventoId: EVENTO });
  assert.deepEqual(calls[0], { ctx: cliente, solicitudId: SOLICITUD, eventoId: EVENTO });
  assert.deepEqual(firmas[0].opciones, { bucket: 'solicitudes' });
  assert.equal(firmas[0].segundos, 300);
  assert.deepEqual(r, { url: `https://firmada/${TENANT}/u/eventos/${SOLICITUD}/f.png`, expiraEnSegundos: 300 });
});

test('ids inválidos → 400 y el admin → 403, sin consultar', async () => {
  for (const [user, solicitudId, eventoId, status] of [
    [cliente, 'abc', EVENTO, 400],
    [cliente, SOLICITUD, 'abc', 400],
    [{ ...cliente, role: 'ADMIN' }, SOLICITUD, EVENTO, 403],
  ]) {
    const { uc, calls } = useCase();
    await assert.rejects(uc.evidencia({ user, solicitudId, eventoId }), { statusCode: status });
    assert.equal(calls.length, 0);
  }
});

// Pool simulado de `pg` para el repositorio.
function fakeFactory(respuestas) {
  const sentencias = [];
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      for (const [clave, valor] of Object.entries(respuestas)) if (sql.includes(clave)) return valor;
      return { rows: [] };
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

test('repositorio: verifica el acceso antes de leer la ruta y responde 404E sin evidencia', async () => {
  let r = fakeFactory({ 'SELECT s.estado': { rows: [{ estado: 'EN_EJECUCION' }] }, 'SELECT evidencia_ruta': { rows: [{ evidencia_ruta: 'a/b.png' }] } });
  assert.equal(await new PgServiceEventRepository({ pgPoolFactory: r.factory }).rutaEvidencia(cliente, SOLICITUD, EVENTO), 'a/b.png');
  assert.deepEqual(r.sentencias.find((s) => s.sql.startsWith('SELECT evidencia_ruta')).params, [EVENTO, SOLICITUD, TENANT]);

  for (const filas of [[], [{ evidencia_ruta: null }]]) {
    r = fakeFactory({ 'SELECT s.estado': { rows: [{ estado: 'EN_EJECUCION' }] }, 'SELECT evidencia_ruta': { rows: filas } });
    await assert.rejects(new PgServiceEventRepository({ pgPoolFactory: r.factory }).rutaEvidencia(cliente, SOLICITUD, EVENTO), {
      statusCode: 404,
      code: 'MANI-EVT-404E',
    });
  }

  r = fakeFactory({});
  await assert.rejects(new PgServiceEventRepository({ pgPoolFactory: r.factory }).rutaEvidencia(cliente, SOLICITUD, EVENTO), {
    code: 'MANI-EVT-404',
  });
  assert.ok(!r.sentencias.some((s) => s.sql.startsWith('SELECT evidencia_ruta')));
});

test('el almacenamiento firma en el bucket pedido y por omisión sigue en kyc-documentos', async () => {
  const storage = new InMemoryFileStorageService();
  assert.match((await storage.createSignedUrl('t/u/doc.pdf')).signedUrl, /\/kyc-documentos\/t\/u\/doc\.pdf\?/);
  assert.match((await storage.createSignedUrl('solicitudes/t/u/f.png', 60, { bucket: 'solicitudes' })).signedUrl, /\/solicitudes\/t\/u\/f\.png\?.*expiresIn=60/);
});
