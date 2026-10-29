const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const config = require('../../config');
const { claimRoleToDomain } = require('./claimRoleMap');
const JwtVerifier = require('./JwtVerifier');

/**
 * Fecha límite oficial de retiro de HS256: 2026-11-15 (Cierre Sprint 5).
 * A partir de esa fecha, todos los clientes deben autenticar exclusivamente con ES256 vía JWKS (ADR-0031 §1).
 */
const HS256_RETIREMENT_DATE = '2026-11-15';

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

class TokenService extends ITokenService {
  /**
   * @param {{ jwtSecret?: string, jwks?: object, supabaseUrl?: string, issuer?: string, verifier?: object }} [deps]
   *   `jwks`, `issuer` y `verifier` son inyectables para pruebas (doble con `getSigningKey`);
   *   si no se pasan y hay `supabaseUrl`, se derivan del proyecto de Supabase.
   *   La política de firma es la de JwtVerifier, la misma de validate-token
   *   (ADR-0031 §1, SCRUM-1362, SCRUM-1457).
   */
  constructor({ jwtSecret = config.supabaseJwtSecret, jwks, supabaseUrl = config.supabaseUrl, issuer, verifier } = {}) {
    super();
    this.verifier = verifier || new JwtVerifier({ jwtSecret, jwks, supabaseUrl, issuer });
  }

  /**
   * Valida un token para el API Gateway (/auth/validate-token) delegando en JwtVerifier (TEC-10 / SCRUM-1457).
   * Los claims se extraen EXCLUSIVAMENTE de `app_metadata` (Custom Access Token Hook, CFG-12, ADR-0031 §2)
   * sin respaldo a la raíz del token.
   *
   * @param {string} authHeader
   * @returns {Promise<{ valid: true, userId: string, tenantId: string, role: string }>}
   */
  async validateToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') {
      const err = new Error('Encabezado Authorization requerido');
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      const err = new Error('Formato de token inválido. Debe ser: Bearer <token>');
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    let decoded;
    try {
      decoded = await this.verifier.verify(parts[1]);
    } catch (verifyErr) {
      const code = verifyErr.name === 'JwtVerificationError' ? verifyErr.code : 'INVALID_TOKEN';
      const message = verifyErr.name === 'JwtVerificationError' ? verifyErr.message : 'Token de autenticación inválido';
      const err = new Error(message);
      err.code = code;
      throw err;
    }

    const appMetadata = decoded.app_metadata && typeof decoded.app_metadata === 'object' ? decoded.app_metadata : {};
    const tenantId = appMetadata.tenant_id;
    const userRole = appMetadata.user_role;
    const userId = decoded.sub;

    if (!isNonEmptyString(tenantId)) {
      const err = new Error('Token de autenticación no contiene el claim obligatorio app_metadata.tenant_id');
      err.code = 'MISSING_TENANT_CLAIM';
      throw err;
    }

    if (!isNonEmptyString(userId) || !isNonEmptyString(userRole)) {
      const err = new Error('Token de autenticación no contiene los claims obligatorios sub y app_metadata.user_role');
      err.code = 'INVALID_TOKEN';
      throw err;
    }

    return {
      valid: true,
      userId,
      tenantId,
      role: userRole,
    };
  }

  /**
   * Verifica criptográficamente la firma y expiración del JWT (ES256 con el
   * JWKS del proyecto o HS256 con el secreto del ambiente), y extrae
   * userId/tenantId/role EXCLUSIVAMENTE de `app_metadata` (Custom Access Token
   * Hook, CFG-12), con el rol en español minúscula ('aliado'/'cliente'/
   * 'admin_tenant') traducido al dominio en inglés. No hay fallback a
   * `payload.role` ni a `tenant_id` en la raíz del token: en un JWT real de
   * Supabase, `payload.role` es siempre el literal "authenticated" (no es un
   * rol de negocio), así que confiar en él filtraría el claim equivocado en
   * vez de fallar visiblemente.
   * @param {string} authHeader
   * @returns {Promise<{ userId: string, tenantId: string, role: string }>}
   */
  async verifyToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedError('Encabezado Authorization requerido', 'UNAUTHORIZED');
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedError('Formato de token inválido. Debe ser: Bearer <token>', 'TOKEN_INVALID');
    }

    let payload;
    try {
      payload = await this.verifier.verify(parts[1]);
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') {
        throw new UnauthorizedError('El token de autenticación ha expirado', 'TOKEN_EXPIRED');
      }
      throw new UnauthorizedError('Firma o contenido del token inválido', 'TOKEN_INVALID');
    }

    const appMetadata = payload.app_metadata || {};
    const userId = payload.sub;
    const tenantId = appMetadata.tenant_id;
    const rawRole = appMetadata.user_role || appMetadata.rol;

    if (!userId || !tenantId || !rawRole) {
      throw new UnauthorizedError(
        'Token no contiene los claims obligatorios (sub, app_metadata.tenant_id, app_metadata.user_role)',
        'TOKEN_INVALID'
      );
    }

    return { userId, tenantId, role: claimRoleToDomain(rawRole) };
  }
}

module.exports = TokenService;
module.exports.HS256_RETIREMENT_DATE = HS256_RETIREMENT_DATE;
