function correlationId(req, res, next) {
  const id = req.headers['x-correlation-id'] || `node-${Date.now()}`;
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  console.log(`[${new Date().toISOString()}] [${req.method}] ${req.originalUrl} - Correlation: ${id}`);
  next();
}

module.exports = correlationId;
