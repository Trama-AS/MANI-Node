const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createLogger,
  conCorrelationId,
  resolveCorrelationId,
  normalizeEntry,
  SERVICE_NAME,
} = require('../../../src/infrastructure/observability/logger');
const { ejecutarComo } = require('../../../src/application/context/contextoIdentidad');
const correlationIdMiddleware = require('../../../src/middlewares/correlationId.middleware');
const { errorHandler } = require('../../../src/middlewares/errorHandler.middleware');

test('SCRUM-1658: createLogger emite líneas JSON válidas con timestamp, level, service y correlationId', () => {
  const infoLines = [];
  const warnLines = [];
  const errorLines = [];
  const fixedNow = () => new Date('2026-11-16T20:00:00.000Z');

  const log = createLogger({
    infoWriter: (l) => infoLines.push(JSON.parse(l)),
    warnWriter: (l) => warnLines.push(JSON.parse(l)),
    errorWriter: (l) => errorLines.push(JSON.parse(l)),
    now: fixedNow,
  });

  conCorrelationId('corr-123', () => {
    log.info('mensaje informativo');
    log.warn({ event: 'warning_test', detail: 'aviso' });
    log.error({ event: 'error_test', correlationId: 'corr-explicito' });
    log.audit({ action: 'test_audit', actor: 'u-1' });
  });

  assert.equal(infoLines.length, 2);
  assert.deepEqual(infoLines[0], {
    timestamp: '2026-11-16T20:00:00.000Z',
    level: 'INFO',
    service: SERVICE_NAME,
    correlationId: 'corr-123',
    correlation_id: 'corr-123',
    message: 'mensaje informativo',
  });
  assert.equal(infoLines[1].event, 'audit');
  assert.equal(infoLines[1].correlationId, 'corr-123');
  assert.equal(warnLines[0].level, 'WARN');
  assert.equal(warnLines[0].correlationId, 'corr-123');
  assert.equal(errorLines[0].level, 'ERROR');
  assert.equal(errorLines[0].correlationId, 'corr-explicito');
});

test('SCRUM-1658: resolveCorrelationId toma el ID explícito, el del middleware o el de contextoIdentidad', () => {
  assert.equal(resolveCorrelationId({}), 'none');
  assert.equal(resolveCorrelationId({ correlation_id: 'cid-snake' }), 'cid-snake');

  ejecutarComo({ tenantId: '10000000-0000-4000-8000-000000000001', correlationId: 'cid-identidad' }, () => {
    assert.equal(resolveCorrelationId({}), 'cid-identidad');
    conCorrelationId('cid-request', () => {
      assert.equal(resolveCorrelationId({}), 'cid-request');
    });
  });

  const norm = normalizeEntry('INFO', null);
  assert.equal(norm.correlationId, 'none');
});

test('SCRUM-1658: correlationId middleware propaga X-Correlation-ID único y errorHandler registra JSON', () => {
  const headers = {};
  const req = {
    method: 'GET',
    originalUrl: '/api/v1/health',
    headers: { 'x-correlation-id': '  corr-gateway-01  ' },
  };
  const res = {
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  let insideCorrelation = null;
  correlationIdMiddleware(req, res, () => {
    insideCorrelation = resolveCorrelationId();
  });

  assert.equal(req.correlationId, 'corr-gateway-01');
  assert.equal(headers['X-Correlation-ID'], 'corr-gateway-01');
  assert.equal(insideCorrelation, 'corr-gateway-01');

  errorHandler(new Error('fallo inesperado'), req, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.correlationId, 'corr-gateway-01');
});

function listarArchivosJs(dir, acum = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listarArchivosJs(full, acum);
    else if (entry.name.endsWith('.js')) acum.push(full);
  }
  return acum;
}

test('SCRUM-1658 (QAS-22): ningún archivo de src/ fuera de logger.js invoca console.* directamente', () => {
  const srcDir = path.resolve(__dirname, '../../../src');
  const loggerPath = path.resolve(srcDir, 'infrastructure/observability/logger.js');
  const violaciones = [];

  for (const archivo of listarArchivosJs(srcDir)) {
    if (archivo === loggerPath) continue;
    const contenido = fs.readFileSync(archivo, 'utf8');
    const lineas = contenido.split(/\r?\n/);
    lineas.forEach((linea, idx) => {
      const sinComentario = linea.replace(/\/\/.*$/, '');
      if (/\bconsole\.(log|info|warn|error)\b/.test(sinComentario)) {
        violaciones.push(`${path.relative(srcDir, archivo)}:${idx + 1}`);
      }
    });
  }

  assert.deepEqual(violaciones, []);
});
