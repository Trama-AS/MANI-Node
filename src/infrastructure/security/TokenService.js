const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const config = require('../../config');
const { claimRoleToDomain } = require('./claimRoleMap');
const JwtVerifier = require('./JwtVerifier');

class TokenService extends ITokenService {
  /**
   * @param {{ jwtSecret?: string, jwks?: object, supabaseUrl?: string, issuer?: string }} [deps]
   *   `jwks` e `issuer` son inyectables para pruebas (doble con `getSigningKey`);
   *   si no se pasan y hay `supabaseUrl`, se derivan del proyecto de Supabase.
   *   La política de firma es la de JwtVerifier, la misma de validate-token
   *   (ADR-0031 §1, SCRUM-1362).
   */
  constructor({ jwtSecret = config.supabaseJwtSecret, jwks, supabaseUrl = config.supabaseUrl, issuer } = {}) {
    super();
    this.verifier = new JwtVerifier({ jwtSecret, jwks, supabaseUrl, issuer });
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

    const token = parts[1];
    if (!token) {
      throw new UnauthorizedError('Token no provisto', 'TOKEN_INVALID');
    }

    let payload;
    try {
      payload = await this.verifier.verify(token);
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
