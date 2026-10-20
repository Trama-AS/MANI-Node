const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseFileStorageService = require('../../../src/infrastructure/security/SupabaseFileStorageService');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeStorageClient(error) {
  let capturedPath;
  const client = {
    storage: {
      from: (bucket) => ({
        upload: async (path, _buffer, _options) => {
          capturedPath = `${bucket}/${path}`;
          return { data: error ? null : { path }, error };
        },
      }),
    },
  };
  return { client, getCapturedPath: () => capturedPath };
}

test('upload sube al bucket kyc-documentos bajo {tenantId}/{usuarioId}/...', async () => {
  const { client, getCapturedPath } = makeStorageClient(null);
  const service = new SupabaseFileStorageService({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await service.upload({ path: 'trama-demo/user-1/cedula.pdf', buffer: Buffer.from('x'), contentType: 'application/pdf' });

  assert.equal(result.path, 'kyc-documentos/trama-demo/user-1/cedula.pdf');
  assert.equal(getCapturedPath(), 'kyc-documentos/trama-demo/user-1/cedula.pdf');
});

test('upload lanza DomainError INTERNAL_ERROR si Supabase Storage reporta error', async () => {
  const { client } = makeStorageClient({ message: 'bucket not found' });
  const service = new SupabaseFileStorageService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.upload({ path: 't1/u1/x.pdf', buffer: Buffer.from('x'), contentType: 'application/pdf' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
