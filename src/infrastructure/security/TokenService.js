const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const ITokenService = require('../../domain/ports/ITokenService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const config = require('../../config');
const { claimRoleToDomain } = require('./claimRoleMap');

class TokenService extends ITokenService {
  /**
   * @param {{ jwtSecret?: string, jwks?: object, supabaseUrl?: string }} [deps]
   *   `jwks` es inyectable para pruebas (doble con `getSigningKey`); si no se
   *   pasa y hay `supabaseUrl`, se construye un cliente real contra el
   *   endpoint JWKS del proyecto.
   */
  constructor({ jwtSecret = config.supabaseJwtSecret, jwks, supabaseUrl = config.supabaseUrl } = {}) {
    super();
    this.jwtSecret = jwtSecret;
    this.jwks = jwks || (supabaseUrl ? jwksClient({ jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json` }) : null);
  }

  /**
   * jsonwebtoken invoca esto con el header del JWT (sin verificar todavía) y
   * debe resolver la clave correcta según el algoritmo declarado:
   * HS256 -> secreto compartido (DEV/test y proyectos de Supabase legacy);
   * ES256 -> clave pública del JWKS del proyecto (Supabase con signing keys
   * asimétricas, ver PoC CFG-12). No hay "clave por defecto": un alg no
   * soportado o sin la clave correspondiente configurada siempre falla.
   */
  _resolveKey(header, callback) {
    if (header.alg === 'HS256') {
      if (!this.jwtSecret) return callback(new Error('No hay secreto HS256 configurado'));
      return callback(null, this.jwtSecret);
    }
    if (header.alg === 'ES256') {
      if (!this.jwks) return callback(new Error('No hay JWKS configurado para verificar ES256'));
      return this.jwks.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
      });
    }
    callback(new Error(`Algoritmo de firma no soportado: ${header.alg}`));
  }

  /**
   * Verifica criptográficamente la firma y expiración del JWT (HS256 o
   * ES256, según lo que declare su header), y extrae userId/tenantId/role
   * EXCLUSIVAMENTE de `app_metadata` (Custom Access Token Hook, CFG-12), con
   * el rol en español minúscula ('aliado'/'cliente'/'admin_tenant') traducido
   * al dominio en inglés. No hay fallback a `payload.role` ni a `tenant_id`
   * en la raíz del token: en un JWT real de Supabase, `payload.role` es
   * siempre el literal "authenticated" (no es un rol de negocio), así que
   * confiar en él filtraría el claim equivocado en vez de fallar visiblemente.
   * @param {string} authHeader
   * @returns {Promise<{ userId: string, tenantId: string, role: string }>}
   */
  verifyToken(authHeader) {
    return new Promise((resolve, reject) => {
      if (!authHeader || typeof authHeader !== 'string') {
        return reject(new UnauthorizedError('Encabezado Authorization requerido', 'UNAUTHORIZED'));
      }

      const parts = authHeader.trim().split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return reject(new UnauthorizedError('Formato de token inválido. Debe ser: Bearer <token>', 'TOKEN_INVALID'));
      }

      const token = parts[1];
      if (!token) {
        return reject(new UnauthorizedError('Token no provisto', 'TOKEN_INVALID'));
      }

      jwt.verify(token, this._resolveKey.bind(this), { algorithms: ['HS256', 'ES256'] }, (err, payload) => {
        if (err) {
          if (err.name === 'TokenExpiredError') {
            return reject(new UnauthorizedError('El token de autenticación ha expirado', 'TOKEN_EXPIRED'));
          }
          return reject(new UnauthorizedError('Firma o contenido del token inválido', 'TOKEN_INVALID'));
        }

        const appMetadata = payload.app_metadata || {};
        const userId = payload.sub;
        const tenantId = appMetadata.tenant_id;
        const rawRole = appMetadata.user_role || appMetadata.rol;

        if (!userId || !tenantId || !rawRole) {
          return reject(
            new UnauthorizedError(
              'Token no contiene los claims obligatorios (sub, app_metadata.tenant_id, app_metadata.user_role)',
              'TOKEN_INVALID'
            )
          );
        }

        resolve({ userId, tenantId, role: claimRoleToDomain(rawRole) });
      });
    });
  }
}

module.exports = TokenService;
