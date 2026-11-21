const { logger, conCorrelationId } = require('../infrastructure/observability/logger');

function correlationId(req, res, next) {
  const raw = req.headers['x-correlation-id'];
  const id = (typeof raw === 'string' && raw.trim()) ? raw.trim() : `node-${Date.now()}`;
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  conCorrelationId(id, () => {
    logger.info({
      event: 'http_request',
      method: req.method,
      path: req.originalUrl,
      correlationId: id,
      message: `[${req.method}] ${req.originalUrl}`,
    });
    next();
  });
}

module.exports = correlationId;
