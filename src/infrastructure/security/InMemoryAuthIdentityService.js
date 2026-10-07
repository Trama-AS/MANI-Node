const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');
const { domainRoleToClaim } = require('./claimRoleMap');

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Sustituto de Supabase Auth para DEV/test: no persiste en una tabla real,
 * pero sí hashea la contraseña (bcrypt) y emite JWTs reales firmados con
 * config.supabaseJwtSecret, con la misma forma que un JWT real de Supabase
 * (claims bajo `app_metadata`) para que TokenService no distinga entornos.
 */
class InMemoryAuthIdentityService extends IAuthIdentityService {
  constructor({ jwtSecret }) {
    super();
    this.jwtSecret = jwtSecret;
    this.identities = new Map(); // key: `${tenantId}::${email}` -> { userId, passwordHash, tenantId, role }
  }

  async createUser({ tenantId, email, password, role }) {
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    this.identities.set(`${tenantId}::${email.toLowerCase()}`, { userId, passwordHash, tenantId, role });
    return { userId };
  }

  async authenticate({ tenantId, email, password }) {
    const identity = this.identities.get(`${tenantId}::${email.toLowerCase()}`);
    if (!identity || !(await bcrypt.compare(password, identity.passwordHash))) {
      throw new UnauthorizedError('Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    const claims = {
      sub: identity.userId,
      app_metadata: { tenant_id: identity.tenantId, user_role: domainRoleToClaim(identity.role) },
    };
    const accessToken = jwt.sign(claims, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = jwt.sign({ ...claims, type: 'refresh' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }
}

module.exports = InMemoryAuthIdentityService;
