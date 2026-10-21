const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseDocumentoKycRepository = require('../../../src/infrastructure/repositories/SupabaseDocumentoKycRepository');
const { mapDocumentoKyc } = require('../../../src/application/useCases/verification/allyVerificationMapper');
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

// Columnas de `documento_kyc` en el esquema base (MANI-APIGateway database/init/01-schema.sql).
// La fecha de carga se llama `fecha_carga`; no existe `created_at` (regresión R-03 del Sprint 4).
const COLUMNAS_DOCUMENTO_KYC = ['id', 'tenant_id', 'aliado_id', 'tipo_documento', 'ruta_storage', 'estado', 'fecha_carga'];

// Registra la tabla, las columnas pedidas a .select() y los filtros .eq() de la cadena de supabase-js.
function makeRecordingClient(result) {
  const calls = { table: null, select: null, eq: [] };
  const builder = {
    select: (columnas) => {
      calls.select = columnas;
      return builder;
    },
    eq: (column, value) => {
      calls.eq.push([column, value]);
      return builder;
    },
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return {
    calls,
    client: {
      from: (table) => {
        calls.table = table;
        return builder;
      },
    },
  };
}

test('findByAliadoId solo pide columnas que existen en documento_kyc, con fecha_carga y sin created_at', async () => {
  const fila = {
    id: 'd1',
    tenant_id: 't1',
    aliado_id: 'a1',
    tipo_documento: 'CEDULA_CIUDADANIA',
    ruta_storage: 't1/a1/cedula.pdf',
    estado: 'PENDIENTE',
    fecha_carga: '2026-10-20T15:00:00.000Z',
  };
  const { calls, client } = makeRecordingClient({ data: [fila], error: null });
  const repo = new SupabaseDocumentoKycRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const docs = await repo.findByAliadoId('t1', 'a1');

  assert.equal(calls.table, 'documento_kyc');
  const pedidas = calls.select.split(',').map((c) => c.trim());
  assert.deepEqual(pedidas, COLUMNAS_DOCUMENTO_KYC);
  assert.ok(!pedidas.includes('created_at'));
  assert.deepEqual(calls.eq, [['tenant_id', 't1'], ['aliado_id', 'a1']]);
  assert.deepEqual(docs, [fila]);
});

test('la vista de verificación muestra la fecha de carga real del documento', () => {
  const vista = mapDocumentoKyc({
    id: 'd1',
    tipo_documento: 'CEDULA_CIUDADANIA',
    ruta_storage: 't1/a1/cedula.pdf',
    estado: 'PENDIENTE',
    fecha_carga: '2026-10-20T15:00:00.000Z',
  });

  assert.equal(vista.fecha_carga, '2026-10-20T15:00:00.000Z');
});

test('findByAliadoId lanza INTERNAL_ERROR si Supabase reporta error', async () => {
  const { client } = makeRecordingClient({ data: null, error: { message: 'column documento_kyc.created_at does not exist' } });
  const repo = new SupabaseDocumentoKycRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByAliadoId('t1', 'a1'),
    (err) => err.code === 'INTERNAL_ERROR' && err.statusCode === 500
  );
});
