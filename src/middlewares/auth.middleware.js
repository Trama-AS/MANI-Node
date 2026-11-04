const container = require('../container');
const { recordAuthValidation } = require('../infrastructure/observability/metrics');
const { tienePermisoPlataforma, ROLES_DE_PLATAFORMA } = require('../application/security/contextoPlataforma');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    recordAuthValidation('failure', 'missing_authorization_header');
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      code: 'UNAUTHORIZED',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const verificada = await container.tokenService.verifyToken(authHeader);
    // SCRUM-901: el administrador de plataforma puede operar sobre otro tenant o actuar como un usuario de ese
    // tenant (cabeceras X-Mani-Tenant y X-Mani-Actuar-Como). Para los demás roles la sesión no cambia.
    const session = await container.contextoPlataforma.resolver(verificada, req.headers, {
      correlationId: req.correlationId || null,
      metodo: req.method,
      ruta: req.originalUrl,
    });
    req.user = session;
    req.tenantId = session.tenantId;
    next();
  } catch (err) {
    // Mismo formato que el errorHandler: { error, code, correlationId } (T5).
    return res.status(err.statusCode || 401).json({
      error: err.message,
      code: err.code || 'UNAUTHORIZED',
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
      // Las operaciones exclusivas de plataforma siguen abiertas al administrador de plataforma aunque esté
      // administrando otro tenant o actuando como un usuario (SCRUM-901).
      if (ROLES_DE_PLATAFORMA.has(r) && tienePermisoPlataforma(req.user)) return true;
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
