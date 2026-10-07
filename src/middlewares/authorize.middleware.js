// Autorización por rol (RBAC mínimo): debe montarse SIEMPRE después de
// auth.middleware.js, que es quien puebla req.user.role a partir del JWT.
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

module.exports = { requireRole };
