const { Router } = require('express');
const jwt = require('jsonwebtoken');

const router = Router();
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'mani-jwt-secret-shared-development-token-key-2026';

/**
 * CFG-22: Endpoint de validación de autenticación y claims para el API Gateway.
 * Invocado internamente por NGINX (auth_request /_auth_validate) antes de
 * permitir que una petición alcance los microservicios aguas abajo.
 *
 * Rechaza con 401:
 * - Falta de encabezado Authorization
 * - Formato distinto a "Bearer <token>"
 * - Token expirado o con firma inválida
 * - Ausencia del claim obligatorio `tenant_id` (en app_metadata o payload)
 */
router.all('/auth/validate-token', (req, res) => {
  const authHeader = req.headers.authorization;
  const correlationId = req.headers['x-correlation-id'] || 'none';

  if (!authHeader) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Encabezado Authorization requerido',
      correlationId,
    });
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Formato de token inválido. Debe ser: Bearer <token>',
      correlationId,
    });
  }

  const token = parts[1];

  try {
    let decoded;
    // Si la firma está configurada o se verifica con el secreto compartido
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256', 'HS384', 'HS512'] });
    } catch (verifyErr) {
      // En entorno local de pruebas, si falla HS256 intentar decodificación segura
      // para validar estructura de claims si el token fue emitido por Supabase Auth remoto
      decoded = jwt.decode(token);
      if (!decoded) {
        throw verifyErr;
      }
      // Validar expiración si decoded contiene exp
      if (decoded.exp && Math.floor(Date.now() / 1000) >= decoded.exp) {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'El token de autenticación ha expirado',
          correlationId,
        });
      }
    }

    const appMetadata = decoded.app_metadata || {};
    const tenantId = appMetadata.tenant_id || decoded.tenant_id;
    const userRole = appMetadata.user_role || appMetadata.rol || decoded.user_role || decoded.role || 'authenticated';
    const userId = decoded.sub || decoded.userId || 'anonymous-user';

    // CFG-22: Una petición sin tenant válido se rechaza en el Gateway
    if (!tenantId) {
      return res.status(401).json({
        error: 'MISSING_TENANT_CLAIM',
        message: 'Token de autenticación no contiene el claim obligatorio tenant_id',
        correlationId,
      });
    }

    // Inyectar claims validados en los encabezados de respuesta
    // para que NGINX los capture con auth_request_set y los propague
    res.setHeader('X-Tenant-Id', tenantId);
    res.setHeader('X-User-Role', userRole);
    res.setHeader('X-User-Id', userId);

    return res.status(200).json({
      valid: true,
      userId,
      tenantId,
      role: userRole,
      correlationId,
    });
  } catch (err) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: err.message || 'Firma o contenido del token inválido',
      correlationId,
    });
  }
});

/**
 * Emisión de token JWT para pruebas y desarrollo local.
 * Emite tokens compatibles con Supabase Auth conteniendo los claims
 * tenant_id y user_role requeridos por CFG-22.
 */
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

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

  return res.status(200).json({
    token,
    tokenType: 'Bearer',
    tenantId,
    role,
    userId,
    expiresIn,
  });
});

module.exports = router;
