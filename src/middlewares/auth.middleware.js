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

// Autorización por rol (RBAC mínimo): debe montarse SIEMPRE después de
// authenticate, que es quien puebla req.user.role a partir del JWT (ya
// normalizado al dominio en inglés por claimRoleMap, ver TokenService).
function requireRole(...allowedRoles) {
  return function authorize(req, res, next) {
    const role = req.user && req.user.role;

    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Rol no autorizado para esta operación. Roles permitidos: ${allowedRoles.join(', ')}`,
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
