require('dotenv').config();

const config = require('./config');

try {
  config.assertValid();
} catch (err) {
  console.error(`❌ Configuración inválida: ${err.message}`);
  process.exit(1);
}

const app = require('./app');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 MANI-Core-Node [${config.envLabel}] corriendo en el puerto ${config.port}`);
});
