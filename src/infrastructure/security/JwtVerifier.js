const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Audiencia que Supabase Auth pone en los tokens de acceso de usuarios con sesión.
const SUPABASE_AUDIENCE = 'authenticated';

class JwtVerificationError extends Error {
  /**
   * @param {'TOKEN_EXPIRED'|'INVALID_SIGNATURE'|'INVALID_TOKEN'} code
   */
  constructor(code, message) {
    super(message);
    this.name = 'JwtVerificationError';
    this.code = code;
  }
}

function trimTrailingSlashes(url) {
  return url.replace(/\/+$/, '');
}

/**
 * Verificación única de los JWT de la plataforma (ADR-0031 §1, SCRUM-1362).
 * La usan `validate-token` (auth_request del Gateway) y TokenService, para que
 * no existan dos políticas distintas.
 *
 * Algoritmos en lista blanca, cada uno con su propia clave, así un token no
 * puede elegir con qué se verifica ("alg confusion"):
 * - ES256: tokens reales de Supabase Auth. Clave pública del JWKS del proyecto
 *   elegida por `kid`; exige `aud = authenticated` e `iss = <SUPABASE_URL>/auth/v1`.
 * - HS256: secreto compartido del ambiente (secreto JWT legado de Supabase,
 *   /auth/dev-token y los tokens sintéticos de las suites Newman).
 * Cualquier otro algoritmo, o ES256 sin JWKS/issuer configurado, se rechaza.
 */
class JwtVerifier {
  /**
   * @param {{ jwtSecret?: string, supabaseUrl?: string, jwks?: { getSigningKey: Function }, issuer?: string }} [deps]
   *   `jwks` e `issuer` son inyectables para pruebas; por omisión se derivan de `supabaseUrl`.
   */
  constructor({ jwtSecret, supabaseUrl, jwks, issuer } = {}) {
    const base = supabaseUrl ? trimTrailingSlashes(supabaseUrl) : null;
    this.jwtSecret = jwtSecret || null;
    this.issuer = issuer || (base ? `${base}/auth/v1` : null);
    // jwks-rsa cachea las claves por kid y limita las descargas: un kid
    // desconocido no puede usarse para martillar el endpoint del proyecto.
    this.jwks =
      jwks ||
      (base
        ? jwksClient({
            jwksUri: `${base}/auth/v1/.well-known/jwks.json`,
            cache: true,
            cacheMaxEntries: 5,
            cacheMaxAge: 10 * 60 * 1000,
            rateLimit: true,
            jwksRequestsPerMinute: 10,
            timeout: 3000,
          })
        : null);
  }

  /**
   * @param {string} token JWT compacto, sin el prefijo "Bearer ".
   * @returns {Promise<object>} payload verificado.
   * @throws {JwtVerificationError}
   */
  async verify(token) {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) {
      throw new JwtVerificationError('INVALID_TOKEN', 'Token de autenticación inválido');
    }

    const { alg, kid } = decoded.header;
    let key;
    let options;
    if (alg === 'ES256') {
      if (!this.jwks || !this.issuer) {
        throw new JwtVerificationError('INVALID_TOKEN', 'No hay JWKS configurado para verificar ES256');
      }
      if (!kid) {
        throw new JwtVerificationError('INVALID_TOKEN', 'Token ES256 sin kid');
      }
      key = await this._publicKey(kid);
      options = { algorithms: ['ES256'], audience: SUPABASE_AUDIENCE, issuer: this.issuer };
    } else if (alg === 'HS256') {
      if (!this.jwtSecret) {
        throw new JwtVerificationError('INVALID_TOKEN', 'No hay secreto configurado para verificar HS256');
      }
      key = this.jwtSecret;
      options = { algorithms: ['HS256'] };
    } else {
      throw new JwtVerificationError('INVALID_TOKEN', `Algoritmo de firma no permitido: ${alg}`);
    }

    try {
      return jwt.verify(token, key, options);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new JwtVerificationError('TOKEN_EXPIRED', 'El token de autenticación ha expirado');
      }
      throw new JwtVerificationError('INVALID_SIGNATURE', 'Firma criptográfica inválida o token adulterado');
    }
  }

  _publicKey(kid) {
    return new Promise((resolve, reject) => {
      this.jwks.getSigningKey(kid, (err, signingKey) => {
        // kid desconocido o JWKS inalcanzable: falla cerrado, nunca hay clave por omisión.
        if (err || !signingKey) {
          return reject(new JwtVerificationError('INVALID_SIGNATURE', 'No se encontró la clave pública del token'));
        }
        resolve(signingKey.getPublicKey());
      });
    });
  }
}

module.exports = JwtVerifier;
module.exports.JwtVerificationError = JwtVerificationError;
module.exports.SUPABASE_AUDIENCE = SUPABASE_AUDIENCE;
