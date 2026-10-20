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

/**
 * Middleware para exigir roles específicos en la sesión JWT.
 * El rol 'ADMIN' valida tanto 'ADMIN' como 'ADMIN_TENANT' (claim emitido en DB).
 * @param {...string} allowedRoles
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: 'No autenticado o sin rol asignado',
        correlationId: req.correlationId || 'none',
      });
    }

    const userRole = String(req.user.role).toUpperCase();
    const isAllowed = allowedRoles.some((role) => {
      const r = String(role).toUpperCase();
      if (r === 'ADMIN') {
        return userRole === 'ADMIN' || userRole === 'ADMIN_TENANT';
      }
      return userRole === r;
    });

    if (!isAllowed) {
      return res.status(403).json({
        error: `Acceso denegado: se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}`,
        code: 'FORBIDDEN',
        correlationId: req.correlationId || 'none',
      });
    }

    next();
  };
}

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.requireRole = requireRole;

