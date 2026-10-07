const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseDocumentoKycRepository = require('../../../src/infrastructure/repositories/SupabaseDocumentoKycRepository');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeInsertClient(result) {
  return { from: () => ({ insert: () => ({ select: async () => result }) }) };
}

test('createMany inserta todas las filas en estado PENDIENTE', async () => {
  let insertedRows;
  const client = {
    from: () => ({
      insert: (rows) => {
        insertedRows = rows;
        return { select: async () => ({ data: rows, error: null }) };
      },
    }),
  };
  const repo = new SupabaseDocumentoKycRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await repo.createMany('t1', 'a1', [{ tipoDocumento: 'CEDULA_CIUDADANIA', rutaStorage: 't1/u1/cedula.pdf' }]);

  assert.equal(insertedRows[0].estado, 'PENDIENTE');
  assert.equal(insertedRows[0].aliado_id, 'a1');
  assert.equal(insertedRows[0].ruta_storage, 't1/u1/cedula.pdf');
});

test('createMany lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeInsertClient({ data: null, error: { message: 'down' } });
  const repo = new SupabaseDocumentoKycRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.createMany('t1', 'a1', [{ tipoDocumento: 'CEDULA_CIUDADANIA', rutaStorage: 'x' }]),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
