const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');
const { ConflictError, DomainError } = require('../../domain/errors/DomainError');

/**
 * Identidad real contra Supabase Auth (QA/producción): crea el usuario con la
 * API admin (service-role) y luego inicia sesión para obtener el access/refresh
 * token reales — firmados con el JWT secret del proyecto de Supabase, el mismo
 * que TokenService usa para verificar en cada request subsecuente.
 */
class SupabaseAuthIdentityService extends IAuthIdentityService {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async createIdentity({ tenantId, email, password, role }) {
    const client = this.supabaseClientFactory.getClient();

    const { data: created, error: createError } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { tenant_id: tenantId, role },
    });

    if (createError) {
      if (/already|existe|registered/i.test(createError.message)) {
        throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
      }
      throw new DomainError(`No se pudo crear la identidad de autenticación: ${createError.message}`, 'INTERNAL_ERROR', 500);
    }

    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });

    if (signInError || !signedIn.session) {
      throw new DomainError(
        `Usuario creado pero no se pudo iniciar sesión: ${signInError?.message || 'sin sesión'}`,
        'INTERNAL_ERROR',
        500
      );
    }

    return {
      userId: created.user.id,
      accessToken: signedIn.session.access_token,
      refreshToken: signedIn.session.refresh_token,
      expiresIn: signedIn.session.expires_in,
    };
  }
}

module.exports = SupabaseAuthIdentityService;
