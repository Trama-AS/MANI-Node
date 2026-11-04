const KafkaEventPublisher = require('./KafkaEventPublisher');
const OutboxRelay = require('./OutboxRelay');

/**
 * Crea el relay si hay broker configurado (`KAFKA_BROKERS`) y base de datos. Sin broker, devuelve null: los eventos
 * siguen escribiéndose en el outbox, quedan pendientes y se publican cuando se configure (no se pierden ni se inventan).
 * @returns {OutboxRelay | null}
 */
function createOutboxRelay({ config, pgPoolFactory, logger = console, publisherFactory = null }) {
  if (!config.kafkaBrokers || config.kafkaBrokers.length === 0) {
    logger.warn('⚠️  KAFKA_BROKERS no configurado: los eventos de negocio quedan en el outbox sin publicarse.');
    return null;
  }
  if (!pgPoolFactory || !pgPoolFactory.isConfigured || !pgPoolFactory.isConfigured()) {
    logger.warn('⚠️  DATABASE_URL no configurada: el relay del outbox no arranca.');
    return null;
  }
  const publisher = publisherFactory
    ? publisherFactory(config)
    : new KafkaEventPublisher({ brokers: config.kafkaBrokers, clientId: config.kafkaClientId });
  return new OutboxRelay({
    pgPoolFactory,
    publisher,
    intervalMs: config.outboxRelayIntervalMs,
    batchSize: config.outboxRelayBatchSize,
    logger,
  });
}

module.exports = createOutboxRelay;
