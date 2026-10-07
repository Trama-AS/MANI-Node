const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Sustituto de Supabase Auth para DEV/test: no persiste en una tabla real,
 * pero sí hashea la contraseña (bcrypt) y emite JWTs reales firmados con
 * config.supabaseJwtSecret — exactamente lo que TokenService.verifyToken espera.
 */
class InMemoryAuthIdentityService extends IAuthIdentityService {
  constructor({ jwtSecret }) {
    super();
    this.jwtSecret = jwtSecret;
    this.identities = new Map(); // key: `${tenantId}::${email}` -> { userId, passwordHash }
  }

  async createIdentity({ tenantId, email, password, role }) {
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    this.identities.set(`${tenantId}::${email.toLowerCase()}`, { userId, passwordHash });

    const claims = { sub: userId, tenant_id: tenantId, role };
    const accessToken = jwt.sign(claims, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = jwt.sign({ ...claims, type: 'refresh' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });

    return { userId, accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }
}

module.exports = InMemoryAuthIdentityService;
