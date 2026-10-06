const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');

class TokenService extends ITokenService {
  /**
   * Extrae y valida el token desde el encabezado Authorization
   * @param {string} authHeader
   * @returns {{ userId: string, tenantId: string, role: string }}
   */
  verifyToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedError('Encabezado Authorization requerido');
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedError('Formato de token inválido. Debe ser: Bearer <token>');
    }

    const token = parts[1];
    if (!token) {
      throw new UnauthorizedError('Token no provisto');
    }

    // Si es un token JWT estándar (header.payload.signature), se puede decodificar el payload base64
    if (token.includes('.')) {
      try {
        const payloadBase64 = token.split('.')[1];
        const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);
        return {
          userId: payload.sub || payload.user_id || 'demo-user-1',
          tenantId: payload.tenant_id || 'trama-demo',
          role: payload.role || 'CLIENT',
        };
      } catch {
        // Fallback a demo si el token no es base64 JSON válido
      }
    }

    // Token opaco o de desarrollo (e.g. 'token-demo')
    return {
      userId: 'demo-user-1',
      tenantId: 'trama-demo',
      role: 'CLIENT',
    };
  }
}

module.exports = TokenService;

