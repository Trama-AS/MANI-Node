require('dotenv').config();

const app = require('./app');
const config = require('./config');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 MANI-Core-Node corriendo en el puerto ${config.port}`);
});
