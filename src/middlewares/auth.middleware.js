const container = require('../container');
const { recordAuthValidation } = require('../infrastructure/observability/metrics');
const { ejecutarComo } = require('../application/context/contextoIdentidad');
const { tienePermisoPlataforma, ROLES_DE_PLATAFORMA } = require('../application/security/contextoPlataforma');

/**
 * Sesión efectiva de la petición (SCRUM-901): el administrador de plataforma puede operar sobre otro tenant o actuar
 * como un usuario de ese tenant (cabeceras X-Mani-Tenant y X-Mani-Actuar-Como); para los demás roles es la del JWT.
 * Es la que se fija como identidad de la petición, así app.set_context usa el tenant, el usuario y el rol efectivos
 * (SCRUM-1468) y RLS aísla igual que para ese usuario.
 */
async function resolverSesion(req, authHeader) {
  const verificada = await container.tokenService.verifyToken(authHeader);
  return container.contextoPlataforma.resolver(verificada, req.headers, {
    correlationId: req.correlationId || null,
    metodo: req.method,
    ruta: req.originalUrl,
  });
}

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

  let session;
  try {
    session = await resolverSesion(req, authHeader);
  } catch (err) {
    // Mismo formato que el errorHandler: { error, code, correlationId } (T5).
    return res.status(err.statusCode || 401).json({
      error: err.message,
      code: err.code || 'UNAUTHORIZED',
      correlationId: req.correlationId || 'none',
    });
  }

  req.user = session;
  req.tenantId = session.tenantId;
  // La identidad verificada acompaña al resto de la petición: los repositorios la usan para fijar el usuario y el
  // rol en app.set_context, porque Core se conecta sin BYPASSRLS (SCRUM-1468). `next` queda fuera del try: un
  // error de la ruta no debe responderse como un 401.
  return ejecutarComo(
    { tenantId: session.tenantId, userId: session.userId, role: session.role, correlationId: req.correlationId || null },
    () => next()
  );
}

/**
 * Para las rutas cuyo controlador verifica el token por su cuenta y responde su propio 401 (verificación de aliados,
 * perfil propio, disponibilidad): si el token es válido, deja la sesión en `req.user` y fija la identidad de la
 * petición, igual que `authenticate`; si falta o no es válido, sigue sin identidad y el controlador responde con su
 * código de siempre. Así los repositorios fijan el usuario y el rol en app.set_context (SCRUM-1468) sin cambiar el
 * contrato de error de esas rutas.
 *
 * Un token válido cuyo contexto de plataforma se rechaza (p. ej. un rol sin permiso de plataforma que envía
 * X-Mani-Actuar-Como, 403 MANI-PLA-403) sí se responde aquí: dejarlo seguir haría que la ruta lo atendiera como el
 * usuario del token e ignorara lo que pidió (SCRUM-901).
 */
async function identificarSiHayToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  let verificada;
  try {
    verificada = await container.tokenService.verifyToken(authHeader);
  } catch {
    return next();
  }

  let session;
  try {
    session = await container.contextoPlataforma.resolver(verificada, req.headers, {
      correlationId: req.correlationId || null,
      metodo: req.method,
      ruta: req.originalUrl,
    });
  } catch (err) {
    return res.status(err.statusCode || 403).json({
      error: err.message,
      code: err.code || 'FORBIDDEN',
      correlationId: req.correlationId || 'none',
    });
  }

  req.user = session;
  req.tenantId = session.tenantId;
  return ejecutarComo(
    { tenantId: session.tenantId, userId: session.userId, role: session.role, correlationId: req.correlationId || null },
    () => next()
  );
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
module.exports.identificarSiHayToken = identificarSiHayToken;
