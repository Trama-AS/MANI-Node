const jwt = require('jsonwebtoken');
const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const config = require('../../config');
const { claimRoleToDomain } = require('./claimRoleMap');

class TokenService extends ITokenService {
  constructor({ jwtSecret = config.supabaseJwtSecret } = {}) {
    super();
    this.jwtSecret = jwtSecret;
  }

  /**
   * Verifica criptográficamente la firma (HS256) y expiración del JWT, y extrae
   * userId/tenantId/role. Los JWT reales de Supabase llevan tenant_id y el rol
   * anidados bajo `app_metadata` (Custom Access Token Hook, CFG-12), con el rol
   * en español minúscula ('aliado'/'cliente'/'admin_tenant'); se traduce al
   * dominio en inglés. También acepta tenant_id/role en la raíz del payload
   * (forma que usa InMemoryAuthIdentityService en DEV/test). No hay fallback a
   * un usuario demo: un token inválido o sin esos claims siempre falla.
   * @param {string} authHeader
   * @returns {{ userId: string, tenantId: string, role: string }}
   */
  verifyToken(authHeader) {
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

    try {
      const payload = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] });

      const appMetadata = payload.app_metadata || {};
      const userId = payload.sub || payload.user_id;
      const tenantId = appMetadata.tenant_id || payload.tenant_id;
      const rawRole = appMetadata.user_role || appMetadata.rol || payload.role;
      const role = claimRoleToDomain(rawRole) || 'CLIENT';

      if (!userId || !tenantId) {
        throw new UnauthorizedError('Token no contiene los claims obligatorios (sub, tenant_id)', 'TOKEN_INVALID');
      }

      return { userId, tenantId, role };
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedError('El token de autenticación ha expirado', 'TOKEN_EXPIRED');
      }
      throw new UnauthorizedError('Firma o contenido del token inválido', 'TOKEN_INVALID');
    }
  }
}

module.exports = TokenService;
