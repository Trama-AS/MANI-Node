const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({
  app: 'mani-core-node',
});

// Métricas por defecto del proceso / runtime Node.js (memoria, CPU, event loop)
client.collectDefaultMetrics({ register });

// 1. Contador de peticiones HTTP
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de peticiones HTTP procesadas por metodo, ruta y codigo de estado',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 2. Histograma de duración de peticiones HTTP
const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duracion de las peticiones HTTP en segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// 3. Contador de validaciones de autenticación (TEC-14 / R-4)
const authValidationsTotal = new client.Counter({
  name: 'auth_validations_total',
  help: 'Total de validaciones de tokens JWT desglosadas por resultado y motivo',
  labelNames: ['result', 'reason'],
  registers: [register],
});

function recordAuthValidation(result, reason = 'ok') {
  authValidationsTotal.inc({ result, reason });
}

async function getMetrics() {
  return await register.metrics();
}

function getContentType() {
  return register.contentType;
}

function resetMetrics() {
  register.resetMetrics();
}

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  authValidationsTotal,
  recordAuthValidation,
  getMetrics,
  getContentType,
  resetMetrics,
};
