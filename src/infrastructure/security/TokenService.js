const jwt = require('jsonwebtoken');
const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const config = require('../../config');

class TokenService extends ITokenService {
  constructor({ jwtSecret = config.supabaseJwtSecret } = {}) {
    super();
    this.jwtSecret = jwtSecret;
  }

  /**
   * Verifica criptográficamente la firma (HS256) y expiración del JWT, y extrae
   * los claims del contrato OpenAPI (sub, tenant_id, role). No hay fallback a
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

      const userId = payload.sub || payload.user_id;
      const tenantId = payload.tenant_id;
      const role = payload.role || 'CLIENT';

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
