const { httpRequestsTotal, httpRequestDurationSeconds } = require('../infrastructure/observability/metrics');

function normalizeRoute(req) {
  let path = req.route ? req.baseUrl + req.route.path : req.path || '/';
  // Reemplazar UUIDs por ':id'
  path = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  // Reemplazar IDs numéricos
  path = path.replace(/\/\d+(\/|$)/g, '/:id$1');
  return path || '/';
}

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics' || req.path === '/api/v1/metrics') {
    return next();
  }

  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const route = normalizeRoute(req);
    const method = req.method;
    const statusCode = String(res.statusCode);

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSeconds);
  });

  next();
}

module.exports = metricsMiddleware;
