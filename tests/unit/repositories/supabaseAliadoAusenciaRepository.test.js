const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseAliadoAusenciaRepository = require('../../../src/infrastructure/repositories/SupabaseAliadoAusenciaRepository');
const AllyAbsence = require('../../../src/domain/entities/AllyAbsence');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

const ID = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: ID,
  tenant_id: 't1',
  aliado_id: 'a1',
  inicio: '2026-10-20T13:00:00+00:00',
  fin: '2026-10-25T23:00:00+00:00',
  motivo: 'VACACIONES',
  nota: null,
};

/**
 * Cliente fluido que registra cada llamada (método y argumentos) y resuelve con
 * `result` al final de la cadena, tanto si se espera el builder como si se
 * llama a single()/maybeSingle().
 */
function makeRecordingClient(result) {
  const calls = [];
  const builder = {};
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'gt', 'order']) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return {
    calls,
    from: (table) => {
      calls.push(['from', table]);
      return builder;
    },
  };
}

function makeRepo(result) {
  const client = makeRecordingClient(result);
  return { client, repo: new SupabaseAliadoAusenciaRepository({ supabaseClientFactory: makeFakeClientFactory(client) }) };
}

const absence = () =>
  new AllyAbsence({
    id: ID,
    tenantId: 't1',
    aliadoId: 'a1',
    startsAt: '2026-10-20T08:00:00-05:00',
    endsAt: '2026-10-25T18:00:00-05:00',
    reason: 'VACACIONES',
  });

test('findByAliadoId filtra por tenant, aliado y fin futuro, y mapea a entidades', async () => {
  const { client, repo } = makeRepo({ data: [ROW], error: null });

  const result = await repo.findByAliadoId('t1', 'a1', new Date('2026-10-17T00:00:00Z'));

  assert.equal(result[0] instanceof AllyAbsence, true);
  assert.equal(result[0].reason, 'VACACIONES');
  assert.deepEqual(client.calls.filter(([m]) => m === 'eq'), [['eq', 'tenant_id', 't1'], ['eq', 'aliado_id', 'a1']]);
  assert.deepEqual(client.calls.find(([m]) => m === 'gt'), ['gt', 'fin', '2026-10-17T00:00:00.000Z']);
});

test('findById con un id que no es UUID retorna null sin consultar', async () => {
  const { client, repo } = makeRepo({ data: ROW, error: null });

  assert.equal(await repo.findById('t1', 'a1', 'no-es-uuid'), null);
  assert.equal(client.calls.length, 0);
  assert.equal((await repo.findById('t1', 'a1', ID)).id, ID);
});

test('findOverlapping consulta el cruce de rangos y excluye la propia ausencia al editar', async () => {
  const { client, repo } = makeRepo({ data: [], error: null });
  const probe = absence();

  await repo.findOverlapping('t1', 'a1', probe.startsAt, probe.endsAt, ID);

  assert.deepEqual(client.calls.find(([m]) => m === 'lt'), ['lt', 'inicio', '2026-10-25T23:00:00.000Z']);
  assert.deepEqual(client.calls.find(([m]) => m === 'gt'), ['gt', 'fin', '2026-10-20T13:00:00.000Z']);
  assert.deepEqual(client.calls.find(([m]) => m === 'neq'), ['neq', 'id', ID]);
});

test('create inserta con nombres del esquema real y retorna la entidad', async () => {
  const { client, repo } = makeRepo({ data: ROW, error: null });

  const created = await repo.create(absence());

  const [, row] = client.calls.find(([m]) => m === 'insert');
  assert.deepEqual(Object.keys(row).sort(), ['aliado_id', 'fin', 'inicio', 'motivo', 'nota', 'tenant_id']);
  assert.equal(created.id, ID);
});

test('las restricciones de la tabla se traducen a errores de negocio', async () => {
  const cases = [
    [{ code: '23P01', message: 'conflicting key value violates exclusion constraint' }, 'MANI-AUS-409', 409],
    [{ code: '23514', message: 'violates check constraint' }, 'MANI-AUS-422H', 422],
    [{ code: '23503', message: 'violates foreign key constraint "fk_aliado_ausencia_aliado_tenant"' }, 'MANI-AUS-403', 403],
    [{ code: '08006', message: 'connection failure' }, 'INTERNAL_ERROR', 500],
  ];
  for (const [error, code, statusCode] of cases) {
    const { repo } = makeRepo({ data: null, error });
    await assert.rejects(repo.create(absence()), (err) => {
      assert.equal(err.code, code);
      assert.equal(err.statusCode, statusCode);
      return true;
    });
  }
});

test('update retorna null si la ausencia no es del aliado y tenant', async () => {
  const { repo } = makeRepo({ data: null, error: null });

  assert.equal(await repo.update(absence()), null);
});

test('delete retorna true solo si borró una fila', async () => {
  assert.equal(await makeRepo({ data: [{ id: ID }], error: null }).repo.delete('t1', 'a1', ID), true);
  assert.equal(await makeRepo({ data: [], error: null }).repo.delete('t1', 'a1', ID), false);
  assert.equal(await makeRepo({ data: [], error: null }).repo.delete('t1', 'a1', 'x'), false);
});
