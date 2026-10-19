const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseFileStorageService = require('../../../src/infrastructure/security/SupabaseFileStorageService');

function fakeStorage({ error = null } = {}) {
  const llamadas = [];
  const client = {
    storage: {
      from: (bucket) => ({
        upload: async (path) => { llamadas.push(['upload', bucket, path]); return { error }; },
        remove: async (paths) => { llamadas.push(['remove', bucket, paths]); return { error }; },
      }),
    },
  };
  return { service: new SupabaseFileStorageService({ supabaseClientFactory: { getClient: () => client } }), llamadas };
}

test('por omisión sube al bucket kyc-documentos y devuelve bucket/ruta', async () => {
  const { service, llamadas } = fakeStorage();

  const r = await service.upload({ path: 't/u/a.pdf', buffer: Buffer.from('x'), contentType: 'application/pdf' });

  assert.deepEqual(llamadas, [['upload', 'kyc-documentos', 't/u/a.pdf']]);
  assert.equal(r.path, 'kyc-documentos/t/u/a.pdf');
});

test('admite el bucket solicitudes para subir y borrar', async () => {
  const { service, llamadas } = fakeStorage();

  const r = await service.upload({ path: 't/u/f.png', buffer: Buffer.from('x'), contentType: 'image/png', bucket: 'solicitudes' });
  await service.delete('t/u/f.png', { bucket: 'solicitudes' });

  assert.equal(r.path, 'solicitudes/t/u/f.png');
  assert.deepEqual(llamadas, [['upload', 'solicitudes', 't/u/f.png'], ['remove', 'solicitudes', ['t/u/f.png']]]);
});

test('rechaza un bucket no permitido sin llamar a Storage', async () => {
  const { service, llamadas } = fakeStorage();

  await assert.rejects(() => service.upload({ path: 'x', buffer: Buffer.from('x'), bucket: 'publico' }), /no permitido/);
  await assert.rejects(() => service.delete('x', { bucket: 'publico' }), /no permitido/);
  assert.equal(llamadas.length, 0);
});

test('un error de Storage al borrar se propaga como INTERNAL_ERROR', async () => {
  const { service } = fakeStorage({ error: { message: 'boom' } });

  await assert.rejects(() => service.delete('t/u/f.png', { bucket: 'solicitudes' }), (e) => e.code === 'INTERNAL_ERROR');
});
