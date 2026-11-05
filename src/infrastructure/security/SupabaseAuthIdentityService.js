const { createClient } = require('@supabase/supabase-js');
const IAuthIdentityService = require('../../domain/ports/IAuthIdentityService');
const jwt = require('jsonwebtoken');
const { ConflictError, DomainError, UnauthorizedError, ValidationError } = require('../../domain/errors/DomainError');

const INVALID_RECOVERY_TOKEN = () =>
  new UnauthorizedError('El enlace de recuperación no es válido o ya venció', 'INVALID_RECOVERY_TOKEN');

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

  async deleteUser(userId) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new DomainError(`Error eliminando identidad de autenticación: ${error.message}`, 'INTERNAL_ERROR', 500);
  }

  async requestPasswordRecovery({ email, redirectTo }) {
    if (!this.supabaseAnonKey) {
      throw new DomainError('SUPABASE_ANON_KEY no está configurada', 'INTERNAL_ERROR', 500);
    }
    // Cliente descartable, como en authenticate(): resetPasswordForEmail no debe tocar el de service-role.
    const disposableClient = this.createDisposableClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await disposableClient.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) {
      if (error.status === 429 || /rate.?limit/i.test(`${error.code || ''} ${error.message || ''}`)) {
        throw new DomainError('Se enviaron demasiados correos de recuperación; intenta más tarde', 'RATE_LIMITED', 429);
      }
      throw new DomainError('No se pudo enviar el correo de recuperación', 'INTERNAL_ERROR', 500);
    }
  }

  async resolveRecoveryUser(accessToken) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data?.user?.id) throw INVALID_RECOVERY_TOKEN();

    // Un token de sesión normal (inicio de sesión con contraseña) no sirve para restablecerla sin conocerla:
    // solo el que nace del enlace del correo. El proveedor ya verificó la firma y la vigencia con getUser().
    const amr = jwt.decode(accessToken)?.amr;
    if (Array.isArray(amr) && amr.some((entry) => entry?.method === 'password')) throw INVALID_RECOVERY_TOKEN();

    return { userId: data.user.id };
  }

  async updatePassword(userId, newPassword, accessToken) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) {
      if (/password|weak|short/i.test(`${error.code || ''} ${error.message || ''}`)) {
        throw new ValidationError('La contraseña nueva no cumple la política del proveedor', 'WEAK_PASSWORD');
      }
      throw new DomainError('No se pudo actualizar la contraseña', 'INTERNAL_ERROR', 500);
    }

    // El enlace sirve una sola vez: el access_token del correo sigue siendo válido hasta vencer, así que se
    // revoca su sesión ('local' no toca las demás sesiones del usuario). La contraseña ya cambió; si la
    // revocación falla no se le reporta error a la persona, pero queda en el log para operaciones.
    if (accessToken) {
      const { error: revokeError } = await client.auth.admin.signOut(accessToken, 'local');
      if (revokeError) {
        console.warn(`⚠️  No se pudo revocar la sesión del enlace de recuperación del usuario ${userId}: ${revokeError.message}`);
      }
    }
  }
}

module.exports = SupabaseAuthIdentityService;
