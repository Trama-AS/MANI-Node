const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { resolveJwtSecret, isDevTokenEnabled } = require('../config/jwtSecret');

// Los servicios aceptan únicamente HS256 (ADR-0031 §1). Fijar el algoritmo evita
// que un token declare otro distinto ("alg confusion").
const ALLOWED_ALGORITHMS = ['HS256'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function reject(res, status, error, message, correlationId) {
  return res.status(status).json({ error, message, correlationId });
}

/**
 * Construye el router de autenticación. Resolver el secreto aquí hace que un
 * secreto ausente impida arrancar el servicio en vez de degradar la seguridad
 * en silencio (SCRUM-1333).
 */
function createAuthRouter(env = process.env) {
  const jwtSecret = resolveJwtSecret(env);
  const router = Router();

  /**
   * CFG-22: Endpoint de validación de autenticación y claims para el API Gateway.
   * Invocado internamente por NGINX (auth_request /_auth_validate) antes de
   * permitir que una petición alcance los microservicios aguas abajo.
   *
   * Los claims de negocio se toman EXCLUSIVAMENTE de `app_metadata` (ADR-0031 §2):
   * en un JWT de Supabase `role` en la raíz es siempre "authenticated" y un
   * `tenant_id` en la raíz no lo emite el Custom Access Token Hook. Cualquier
   * claim obligatorio ausente se rechaza; no hay valores por omisión.
   *
   * Rechaza con 401:
   * - Falta de encabezado Authorization o formato distinto a "Bearer <token>"
   * - Token expirado, con firma inválida o con otro algoritmo
   * - Ausencia de sub, app_metadata.tenant_id o app_metadata.user_role
   */
  router.all('/auth/validate-token', (req, res) => {
    const authHeader = req.headers.authorization;
    const correlationId = req.headers['x-correlation-id'] || 'none';

    if (!authHeader) {
      return reject(res, 401, 'UNAUTHORIZED', 'Encabezado Authorization requerido', correlationId);
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return reject(res, 401, 'UNAUTHORIZED', 'Formato de token inválido. Debe ser: Bearer <token>', correlationId);
    }

    let decoded;
    try {
      decoded = jwt.verify(parts[1], jwtSecret, { algorithms: ALLOWED_ALGORITHMS });
    } catch (verifyErr) {
      if (verifyErr.name === 'TokenExpiredError') {
        return reject(res, 401, 'TOKEN_EXPIRED', 'El token de autenticación ha expirado', correlationId);
      }
      if (verifyErr.name === 'JsonWebTokenError') {
        return reject(res, 401, 'INVALID_SIGNATURE', 'Firma criptográfica inválida o token adulterado', correlationId);
      }
      return reject(res, 401, 'INVALID_TOKEN', 'Token de autenticación inválido', correlationId);
    }

    const appMetadata = decoded.app_metadata && typeof decoded.app_metadata === 'object' ? decoded.app_metadata : {};
    const tenantId = appMetadata.tenant_id;
    const userRole = appMetadata.user_role;
    const userId = decoded.sub;

    // CFG-22: Una petición sin tenant válido se rechaza en el Gateway
    if (!isNonEmptyString(tenantId)) {
      return reject(
        res,
        401,
        'MISSING_TENANT_CLAIM',
        'Token de autenticación no contiene el claim obligatorio app_metadata.tenant_id',
        correlationId
      );
    }
    if (!isNonEmptyString(userId) || !isNonEmptyString(userRole)) {
      return reject(
        res,
        401,
        'INVALID_TOKEN',
        'Token de autenticación no contiene los claims obligatorios sub y app_metadata.user_role',
        correlationId
      );
    }

    // Inyectar claims validados en los encabezados de respuesta
    // para que NGINX los capture con auth_request_set y los propague
    res.setHeader('X-Tenant-Id', tenantId);
    res.setHeader('X-User-Role', userRole);
    res.setHeader('X-User-Id', userId);

    return res.status(200).json({ valid: true, userId, tenantId, role: userRole, correlationId });
  });

  /**
   * Emisión de token JWT para pruebas y desarrollo local. Firma con el secreto
   * real a petición de cualquiera, así que solo se registra con
   * NODE_ENV=development|test; en cualquier otro entorno la ruta no existe (404).
   */
  if (isDevTokenEnabled(env)) {
    router.post('/auth/dev-token', (req, res) => {
      const {
        tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        role = 'aliado',
        userId = `user-${Date.now()}`,
        expiresIn = '24h',
      } = req.body || {};

      const payload = {
        sub: userId,
        email: `${role}.${Date.now()}@mani.test`,
        role: 'authenticated',
        app_metadata: {
          provider: 'email',
          tenant_id: tenantId,
          user_role: role,
        },
        user_metadata: {
          name: `Usuario ${role}`,
        },
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn, algorithm: 'HS256' });

      return res.status(200).json({ token, tokenType: 'Bearer', tenantId, role, userId, expiresIn });
    });
  }

  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
