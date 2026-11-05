const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');
const { UnauthorizedError } = require('../../domain/errors/DomainError');

const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000;
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
    this.recoveryTokens = new Map(); // token -> { userId, expiresAt }
    this.sentRecoveries = []; // lo que habría enviado el proveedor de correo (solo DEV/test)
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

  async deleteUser(userId) {
    for (const [key, identity] of this.identities.entries()) {
      if (identity.userId === userId) {
        this.identities.delete(key);
        return;
      }
    }
  }

  // Sin proveedor de correo en DEV/test: el token queda en `sentRecoveries`, que es lo que el enlace llevaría.
  async requestPasswordRecovery({ email, redirectTo }) {
    const lower = email.toLowerCase();
    const identity = [...this.identities.entries()].find(([key]) => key.split('::')[1] === lower)?.[1];
    if (!identity) return; // igual que el proveedor real: no revela si la cuenta existe
    const token = crypto.randomBytes(24).toString('base64url');
    this.recoveryTokens.set(token, { userId: identity.userId, expiresAt: Date.now() + RECOVERY_TOKEN_TTL_MS });
    this.sentRecoveries.push({ email: lower, redirectTo: redirectTo || null, token });
  }

  async resolveRecoveryUser(accessToken) {
    const entry = this.recoveryTokens.get(accessToken);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedError('El enlace de recuperación no es válido o ya venció', 'INVALID_RECOVERY_TOKEN');
    }
    return { userId: entry.userId };
  }

  async updatePassword(userId, newPassword) {
    for (const identity of this.identities.values()) {
      if (identity.userId === userId) identity.passwordHash = await bcrypt.hash(newPassword, 10);
    }
    // El enlace sirve una sola vez.
    for (const [token, entry] of this.recoveryTokens.entries()) {
      if (entry.userId === userId) this.recoveryTokens.delete(token);
    }
  }
}

module.exports = InMemoryAuthIdentityService;
