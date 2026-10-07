const { createClient } = require('@supabase/supabase-js');
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
  /**
   * `createDisposableClient` es inyectable (por defecto, `createClient` real
   * de @supabase/supabase-js) para poder probar authenticate() con un doble
   * sin pegarle a una red/proyecto real.
   */
  constructor({ supabaseClientFactory, supabaseUrl, supabaseAnonKey, createDisposableClient = createClient }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
    this.createDisposableClient = createDisposableClient;
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
    if (!this.supabaseAnonKey) {
      throw new DomainError('SUPABASE_ANON_KEY no está configurada', 'INTERNAL_ERROR', 500);
    }

    // Cliente DESCARTABLE, distinto del singleton de service-role: en
    // supabase-js, signInWithPassword muta el estado de auth del cliente que
    // lo invoca y ese cliente reutiliza esa sesión en TODAS sus peticiones
    // posteriores. Si se llamara sobre el cliente de service-role compartido
    // (container.supabaseClientFactory.getClient()), a partir de aquí todo
    // insert/upload del Core -- incluso para otros aliados -- saldría firmado
    // con el JWT de ESTE aliado, y kyc_isolation rechazaría la subida del
    // siguiente con 500 (bug encontrado en revisión de código, B2).
    const disposableClient = this.createDisposableClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await disposableClient.auth.signInWithPassword({ email, password });

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
