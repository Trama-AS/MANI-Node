const test = require('node:test');
const assert = require('node:assert/strict');
const OutboxRelay = require('../../../src/infrastructure/events/OutboxRelay');
const KafkaEventPublisher = require('../../../src/infrastructure/events/KafkaEventPublisher');
const createOutboxRelay = require('../../../src/infrastructure/events/createOutboxRelay');

const FILA = (n) => ({
  id: `e${n}`, tipo_evento: 'PagoRegistrado', version_evento: 1, topico: 'mani.pago.pago-registrado.v1', clave_particion: `s${n}`,
  tenant_id: 't1', correlation_id: 'c1', fecha_ocurrencia: new Date('2026-11-04T01:00:00Z'), payload: { n },
});

/** Pool falso: guion por fragmento de SQL; registra cada consulta. */
function pool(script = {}) {
  const calls = [];
  const liberados = [];
  const client = {
    async query(sql, params) {
      const t = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: t, params });
      for (const [frag, resp] of Object.entries(script)) {
        if (t.includes(frag)) {
          if (resp instanceof Error) throw resp;
          return typeof resp === 'function' ? resp(params) : resp;
        }
      }
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      liberados.push(err || null);
    },
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, calls, liberados };
}
const mudo = { error() {}, warn() {}, log() {} };

test('publica el lote en orden con el sobre común y recién después lo marca publicado', async () => {
  const p = pool({ 'outbox_tomar_pendientes': { rows: [FILA(1), FILA(2)] } });
  const enviados = [];
  const relay = new OutboxRelay({ pgPoolFactory: p.factory, publisher: { publish: async (m) => enviados.push(...m) }, logger: mudo });

  assert.equal(await relay.tick(), 2);

  assert.deepEqual(enviados.map((m) => [m.topic, m.key, m.eventId]), [['mani.pago.pago-registrado.v1', 's1', 'e1'], ['mani.pago.pago-registrado.v1', 's2', 'e2']]);
  assert.equal(JSON.parse(enviados[0].value).event_type, 'PagoRegistrado');
  const verbos = p.calls.map((c) => c.sql.split(' ')[0] + (c.sql.includes('outbox_') ? ':' + c.sql.match(/outbox_\w+/)[0] : ''));
  assert.deepEqual(verbos, ['BEGIN', 'SELECT:outbox_tomar_pendientes', 'SELECT:outbox_marcar_publicados', 'COMMIT']);
  assert.deepEqual(p.calls[2].params, [['e1', 'e2']]);
});

test('sin pendientes confirma y no publica nada', async () => {
  const p = pool();
  let llamadas = 0;
  const relay = new OutboxRelay({ pgPoolFactory: p.factory, publisher: { publish: async () => llamadas++ }, logger: mudo });
  assert.equal(await relay.tick(), 0);
  assert.equal(llamadas, 0);
  assert.deepEqual(p.calls.map((c) => c.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'COMMIT']);
});

test('si publicar falla: ROLLBACK, el fallo se registra y el lote no se marca; el relay no lanza', async () => {
  const p = pool({ 'outbox_tomar_pendientes': { rows: [FILA(1)] } });
  const errores = [];
  const relay = new OutboxRelay({
    pgPoolFactory: p.factory,
    publisher: { publish: async () => { throw new Error('broker caído'); } },
    logger: { ...mudo, error: (m) => errores.push(m) },
  });

  assert.equal(await relay.tick(), 0);

  const sqls = p.calls.map((c) => c.sql);
  assert.ok(sqls.includes('ROLLBACK'));
  assert.ok(!sqls.some((s) => s.includes('outbox_marcar_publicados')));
  const fallo = p.calls.find((c) => c.sql.includes('outbox_registrar_fallo'));
  assert.deepEqual(fallo.params, [['e1'], 'broker caído']);
  assert.match(errores[0], /broker caído/);
});

test('si el ROLLBACK también falla, la conexión se descarta del pool', async () => {
  const p = pool({ 'outbox_tomar_pendientes': { rows: [FILA(1)] }, ROLLBACK: new Error('conexión rota') });
  const relay = new OutboxRelay({ pgPoolFactory: p.factory, publisher: { publish: async () => { throw new Error('x'); } }, logger: mudo });
  await relay.tick();
  assert.ok(p.liberados.some((l) => l && /conexión rota/.test(l.message)));
});

test('sin base configurada no hace nada; el constructor exige sus dependencias', async () => {
  const relay = new OutboxRelay({ pgPoolFactory: { getPool: () => null }, publisher: { publish: async () => {} }, logger: mudo });
  assert.equal(await relay.tick(), 0);
  assert.throws(() => new OutboxRelay({ publisher: {} }), /pgPoolFactory/);
  assert.throws(() => new OutboxRelay({ pgPoolFactory: {} }), /publisher/);
});

test('start/stop: corre en bucle, no se solapa y stop espera la vuelta y cierra el publicador', async () => {
  const p = pool({ 'outbox_tomar_pendientes': { rows: [FILA(1)] } });
  let cerrado = false;
  let publicados = 0;
  const relay = new OutboxRelay({
    pgPoolFactory: p.factory,
    publisher: { publish: async () => { publicados++; }, close: async () => { cerrado = true; } },
    intervalMs: 5,
    logger: mudo,
  });
  relay.start();
  relay.start();
  await new Promise((r) => setTimeout(r, 60));
  await relay.stop();
  assert.ok(publicados >= 2, `se esperaban varias vueltas y hubo ${publicados}`);
  assert.equal(cerrado, true);
  const antes = publicados;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(publicados, antes, 'detenido: no publica más');
});

test('KafkaEventPublisher: conexión perezosa, un envío por tópico con clave y encabezado event-id, sin crear tópicos', async () => {
  const cfgs = [];
  const envios = [];
  let conexiones = 0;
  let desconexiones = 0;
  const kafkaFactory = (cfg) => {
    cfgs.push(cfg);
    return {
      producer: (opts) => {
        cfgs.push(opts);
        return { connect: async () => { conexiones++; }, send: async (e) => { envios.push(e); }, disconnect: async () => { desconexiones++; } };
      },
    };
  };
  const pub = new KafkaEventPublisher({ brokers: ['kafka:9092'], clientId: 'mani-core', kafkaFactory });
  assert.equal(conexiones, 0, 'no conecta al construir');

  await pub.publish([
    { topic: 'a', key: 'k1', value: 'v1', eventId: 'e1' },
    { topic: 'b', key: 'k2', value: 'v2', eventId: 'e2' },
    { topic: 'a', key: 'k3', value: 'v3', eventId: 'e3' },
  ]);
  await pub.publish([{ topic: 'a', key: 'k4', value: 'v4', eventId: 'e4' }]);

  assert.equal(conexiones, 1, 'reutiliza la conexión');
  assert.deepEqual(cfgs[0].brokers, ['kafka:9092']);
  assert.equal(cfgs[1].allowAutoTopicCreation, false);
  assert.equal(cfgs[1].idempotent, true);
  assert.deepEqual(envios[0].messages.map((m) => m.key), ['k1', 'k3'], 'orden del lote dentro del tópico');
  assert.deepEqual(envios[0].messages[0].headers, { 'event-id': 'e1' });
  assert.equal(envios[1].topic, 'b');
  assert.equal(envios[0].acks, -1);
  await pub.close();
  await pub.close();
  assert.equal(desconexiones, 1);
});

test('KafkaEventPublisher exige brokers; si el broker falla, publish lanza para que el relay reintente', async () => {
  assert.throws(() => new KafkaEventPublisher({ brokers: [] }), /brokers/);
  const pub = new KafkaEventPublisher({
    brokers: ['x:1'],
    kafkaFactory: () => ({ producer: () => ({ connect: async () => { throw new Error('ECONNREFUSED'); } }) }),
  });
  await assert.rejects(pub.publish([{ topic: 't', key: 'k', value: 'v', eventId: 'e' }]), /ECONNREFUSED/);
});

test('createOutboxRelay: sin KAFKA_BROKERS o sin base no arranca y lo avisa; con ambos crea el relay', () => {
  const avisos = [];
  const logger = { warn: (m) => avisos.push(m), error() {}, log() {} };
  const conBase = { isConfigured: () => true, getPool: () => ({}) };
  assert.equal(createOutboxRelay({ config: { kafkaBrokers: [] }, pgPoolFactory: conBase, logger }), null);
  assert.match(avisos[0], /KAFKA_BROKERS/);
  assert.equal(createOutboxRelay({ config: { kafkaBrokers: ['k:9092'] }, pgPoolFactory: { isConfigured: () => false }, logger }), null);
  assert.match(avisos[1], /DATABASE_URL/);
  const relay = createOutboxRelay({
    config: { kafkaBrokers: ['k:9092'], kafkaClientId: 'mani-core', outboxRelayIntervalMs: 1000, outboxRelayBatchSize: 10 },
    pgPoolFactory: conBase,
    logger,
    publisherFactory: () => ({ publish: async () => {} }),
  });
  assert.ok(relay instanceof OutboxRelay);
  assert.equal(relay.batchSize, 10);
});
