const container = require('../container');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = await container.tokenService.verifyToken(authHeader);
    req.user = session;
    req.tenantId = session.tenantId;
    next();
  } catch (err) {
    return res.status(err.statusCode || 401).json({
      error: err.message,
      correlationId: req.correlationId || 'none',
    });
  }
}

module.exports = authenticate;
