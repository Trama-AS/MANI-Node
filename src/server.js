require('dotenv').config();

const config = require('./config');

try {
  config.assertValid();
} catch (err) {
  console.error(`❌ Configuración inválida: ${err.message}`);
  process.exit(1);
}

const app = require('./app');

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 MANI-Core-Node [${config.envLabel}] corriendo en el puerto ${config.port}`);
});

// Relay del outbox (SCRUM-889, ADR-0029): solo corre con KAFKA_BROKERS y DATABASE_URL; si no, los eventos esperan.
const container = require('./container');
const createOutboxRelay = require('./infrastructure/events/createOutboxRelay');

const relay = createOutboxRelay({ config, pgPoolFactory: container.pgPoolFactory });
if (relay) relay.start();

async function apagar() {
  if (relay) await relay.stop();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
