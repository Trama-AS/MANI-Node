const { AsyncLocalStorage } = require('node:async_hooks');
const { identidadActual } = require('../../application/context/contextoIdentidad');

const SERVICE_NAME = 'mani-core-node';
const almacenCorrelacion = new AsyncLocalStorage();

function conCorrelationId(correlationId, fn) {
  const limpio = correlationId && String(correlationId).trim() ? String(correlationId).trim() : 'none';
  return almacenCorrelacion.run(limpio, fn);
}

function resolveCorrelationId(entry = {}) {
  const explicit = entry.correlationId ?? entry.correlation_id;
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }
  const enCurso = almacenCorrelacion.getStore();
  if (enCurso && String(enCurso).trim()) {
    return String(enCurso).trim();
  }
  const actual = identidadActual()?.correlationId;
  return actual && String(actual).trim() ? String(actual).trim() : 'none';
}

function normalizeEntry(level, payload, now = () => new Date()) {
  const base = typeof payload === 'string' ? { message: payload } : { ...(payload || {}) };
  const correlationId = resolveCorrelationId(base);
  return {
    timestamp: base.timestamp || now().toISOString(),
    level,
    service: SERVICE_NAME,
    correlationId,
    correlation_id: correlationId,
    ...base,
  };
}

function createLogger({
  infoWriter = (line) => console.info(line),
  warnWriter = (line) => console.warn(line),
  errorWriter = (line) => console.error(line),
  now = () => new Date(),
} = {}) {
  return {
    info(payload) {
      infoWriter(JSON.stringify(normalizeEntry('INFO', payload, now)));
    },
    warn(payload) {
      warnWriter(JSON.stringify(normalizeEntry('WARN', payload, now)));
    },
    error(payload) {
      errorWriter(JSON.stringify(normalizeEntry('ERROR', payload, now)));
    },
    audit(entry) {
      infoWriter(JSON.stringify(normalizeEntry('INFO', { event: 'audit', ...entry }, now)));
    },
  };
}

const logger = createLogger();

module.exports = {
  logger,
  createLogger,
  conCorrelationId,
  resolveCorrelationId,
  normalizeEntry,
  SERVICE_NAME,
};
