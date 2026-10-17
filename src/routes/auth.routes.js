const { Router } = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const authController = require('../controllers/auth.controller');

const router = Router();
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'mani-jwt-secret-shared-development-token-key-2026';

// Whitelist de documentos KYC que acepta el contrato (docs/openapi/core.yaml)
const ALLOWED_DOCUMENT_FIELDS = ['cedula_ciudadania', 'rut_certificado'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_DOCUMENT_FIELDS.length },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      const err = new Error(`Tipo de archivo no permitido: ${file.mimetype}`);
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      return cb(err);
    }
    cb(null, true);
  },
});

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
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256', 'HS384', 'HS512'] });
    } catch (verifyErr) {
      if (verifyErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'El token de autenticación ha expirado',
          correlationId,
        });
      }
      if (verifyErr.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'INVALID_SIGNATURE',
          message: 'Firma criptográfica inválida o token adulterado',
          correlationId,
        });
      }
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: verifyErr.message || 'Token de autenticación inválido',
        correlationId,
      });
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

// upload.fields() rechaza campos fuera de ALLOWED_DOCUMENT_FIELDS con MulterError
router.post(
  '/auth/register/ally',
  upload.fields(ALLOWED_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
  authController.registerAllyNaturalPerson
);

// Sin multer: el registro de Cliente no lleva documentos KYC.
router.post('/auth/register/client', authController.registerClientNaturalPerson);

module.exports = router;
