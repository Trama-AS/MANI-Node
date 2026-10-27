const { Router } = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { resolveJwtSecret, isDevTokenEnabled } = require('../config/jwtSecret');
const JwtVerifier = require('../infrastructure/security/JwtVerifier');

// Whitelist de documentos KYC que acepta el contrato (docs/openapi/core.yaml)
const ALLOWED_DOCUMENT_FIELDS = ['cedula_ciudadania', 'rut_certificado'];
const ALLOWED_COMPANY_DOCUMENT_FIELDS = ['camara_comercio', 'rut_empresa', 'cedula_representante'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const err = new Error(`Tipo de archivo no permitido: ${file.mimetype}`);
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_DOCUMENT_FIELDS.length },
  fileFilter,
});

const uploadCompany = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_COMPANY_DOCUMENT_FIELDS.length },
  fileFilter,
});

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
 *
 * validate-token acepta ES256 (tokens reales de Supabase Auth, verificados con
 * el JWKS de SUPABASE_URL) y HS256 (secreto del ambiente), con la política de
 * JwtVerifier (ADR-0031 §1, SCRUM-1362). `deps.jwtVerifier` es inyectable para
 * pruebas.
 */
function createAuthRouter(env = process.env, deps = {}) {
  const jwtSecret = resolveJwtSecret(env);
  const jwtVerifier = deps.jwtVerifier || new JwtVerifier({ jwtSecret, supabaseUrl: env.SUPABASE_URL });
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
   */
  router.all('/auth/validate-token', async (req, res) => {
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
      decoded = await jwtVerifier.verify(parts[1]);
    } catch (verifyErr) {
      // JwtVerificationError trae TOKEN_EXPIRED | INVALID_SIGNATURE | INVALID_TOKEN;
      // cualquier otro fallo inesperado también se rechaza (falla cerrado).
      const code = verifyErr.name === 'JwtVerificationError' ? verifyErr.code : 'INVALID_TOKEN';
      const message = verifyErr.name === 'JwtVerificationError' ? verifyErr.message : 'Token de autenticación inválido';
      return reject(res, 401, code, message, correlationId);
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

  // upload.fields() rechaza campos fuera de ALLOWED_DOCUMENT_FIELDS con MulterError
  router.post(
    '/auth/register/ally',
    upload.fields(ALLOWED_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
    authController.registerAllyNaturalPerson
  );

  // Registro de aliado empresa (SCRUM-1063): una sola ruta, la que declara el contrato.
  router.post(
    '/auth/register/ally/company',
    uploadCompany.fields(ALLOWED_COMPANY_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
    authController.registerAllyCompany
  );

  // Sin multer: el registro de Cliente no lleva documentos KYC.
  router.post('/auth/register/client', authController.registerClientNaturalPerson);
  // Cliente empresa (HU-M02-07): NIT y representante, sin documentos ni sitios.
  router.post('/auth/register/client/company', authController.registerClientCompany);

  // Cierre de sesión (HU-M02-03): lleva el JWT; Core lo verifica aquí porque /auth/ es público en el Gateway.
  router.post('/auth/logout', authenticate, authController.logout);

  // Recuperación de contraseña (HU-M02-10): pre-auth, el tenant sale solo de X-Tenant-Slug.
  router.post('/auth/password-recovery', authController.requestPasswordRecovery);
  router.post('/auth/password-reset', authController.resetPassword);

  return router;
}

module.exports = createAuthRouter();
module.exports.createAuthRouter = createAuthRouter;
