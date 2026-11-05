require('dotenv').config();

const config = require('./config');

try {
  config.assertValid();
} catch (err) {
  console.error(`❌ Configuración inválida: ${err.message}`);
  process.exit(1);
}

const app = require('./app');
const container = require('./container');
const createOutboxRelay = require('./infrastructure/events/createOutboxRelay');
const { verificarRolServicio } = require('./infrastructure/db/verificarRolServicio');

async function arrancar() {
  // SCRUM-1468: en QA y producción Core no arranca si DATABASE_URL usa un rol que salta RLS.
  await verificarRolServicio(container.pgPoolFactory, {
    exigir: config.environment === 'qa' || config.environment === 'production',
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 MANI-Core-Node [${config.envLabel}] corriendo en el puerto ${config.port}`);
  });

  // Relay del outbox (SCRUM-889, ADR-0029): solo corre con KAFKA_BROKERS y DATABASE_URL; si no, los eventos esperan.
  const relay = createOutboxRelay({ config, pgPoolFactory: container.pgPoolFactory });
  if (relay) relay.start();

  async function apagar() {
    if (relay) await relay.stop();
    server.close(() => process.exit(0));
  }
  process.on('SIGTERM', apagar);
  process.on('SIGINT', apagar);
}

arrancar().catch((err) => {
  console.error(`❌ No se pudo arrancar: ${err.message}`);
  process.exit(1);
});
