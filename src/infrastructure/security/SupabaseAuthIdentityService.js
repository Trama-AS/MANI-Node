const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');
const { ConflictError, DomainError } = require('../../domain/errors/DomainError');

/**
 * Identidad real contra Supabase Auth (QA/producción). createUser() solo crea
 * la cuenta en auth.users (service-role, admin API). authenticate() se llama
 * DESPUÉS de que el caller haya insertado la fila en public.usuario: el
 * Custom Access Token Hook (CFG-12) deriva tenant_id/rol leyendo esa fila, así
 * que si se autentica antes de que exista, la sesión sale con claims vacíos.
 */
class SupabaseAuthIdentityService extends IAuthIdentityService {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async createUser({ email, password }) {
    const client = this.supabaseClientFactory.getClient();

    const { data: created, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      if (/already|existe|registered/i.test(error.message)) {
        throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
      }
      throw new DomainError(`No se pudo crear la identidad de autenticación: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    return { userId: created.user.id };
  }

  async authenticate({ email, password }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new DomainError(
        `Usuario creado pero no se pudo iniciar sesión: ${error?.message || 'sin sesión'}`,
        'INTERNAL_ERROR',
        500
      );
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
    };
  }
}

module.exports = SupabaseAuthIdentityService;
