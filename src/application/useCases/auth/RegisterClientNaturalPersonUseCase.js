const Profile = require('../../../domain/entities/Profile');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ejecuta una limpieza de compensación (B3) sin dejar que un fallo —sea un
 * throw sincrónico o una promesa rechazada— interrumpa el resto de los pasos
 * de limpieza: el objetivo es el mejor esfuerzo posible, nunca todo o nada.
 * (Mismo helper que RegisterAllyNaturalPersonUseCase; se repite aquí porque
 * no hay todavía un módulo compartido de utilidades de casos de uso, y
 * duplicar esta función de 5 líneas es preferible a un acoplamiento entre
 * ambos casos de uso solo para compartirla.)
 */
async function safeRun(fn) {
  try {
    await fn();
  } catch {
    // Mejor esfuerzo: un fallo al compensar no debe ocultar el error original
    // ni impedir que se compensen los demás pasos ya creados.
  }
}

/**
 * Migración de registrar_cliente_persona_natural + la rama CLIENTE de
 * handle_new_user (US-02.2.1-M2). Antes esta lógica vivía en PL/pgSQL,
 * disparada por supabase.auth.signUp() desde el cliente Flutter; ahora Core
 * Node la ejecuta explícitamente, igual que ya hizo
 * RegisterAllyNaturalPersonUseCase para Aliado (US-02.1.1-M2).
 *
 * CA-2 (reutilización): este caso de uso NO crea una segunda implementación
 * de identidad ni un segundo cliente de Supabase. `tenantRepository`,
 * `usuarioRepository` y `authIdentityService` son las MISMAS instancias que
 * ya usa el registro de Aliado — las inyecta `container.js` una sola vez.
 * Lo único nuevo es `clienteRepository` (tabla `cliente`, sin KYC/categoría).
 *
 * A diferencia del Aliado (que queda PENDING a la espera de verificación
 * KYC), el Cliente no tiene documentos que verificar: la cuenta queda
 * ACTIVA/VERIFIED de inmediato, igual que hacía la función PL/pgSQL legacy.
 *
 * Mismo orden de operaciones que el Aliado y por la misma razón: el Custom
 * Access Token Hook de Supabase (CFG-12) deriva tenant_id/rol de
 * `public.usuario`, así que esa fila debe existir ANTES de authenticate().
 */
class RegisterClientNaturalPersonUseCase {
  constructor({ tenantRepository, usuarioRepository, clienteRepository, authIdentityService }) {
    this.tenantRepository = tenantRepository;
    this.usuarioRepository = usuarioRepository;
    this.clienteRepository = clienteRepository;
    this.authIdentityService = authIdentityService;
  }

  _validate({ tenantSlug, fullName, email, password }) {
    if (!tenantSlug) throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      throw new ValidationError('fullName es requerido', 'VALIDATION_ERROR');
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (!password || password.length < 8) {
      throw new ValidationError('password es requerido y debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
    }
  }

  async execute(input) {
    this._validate(input);
    const { tenantSlug, fullName, email, password, phone } = input;

    // ADR-0018 (CA-5): el tenant se resuelve por el slug público, nunca se
    // usa para autorizar -- la cuenta queda aislada en ESTE tenant y nada
    // más confía en este valor después de este punto.
    const tenant = await this.tenantRepository.findBySlug(tenantSlug);

    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantSlug}" no existe`, 'TENANT_NOT_FOUND');
    }
    if (!tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantSlug}" no está activo`, 'TENANT_NOT_FOUND');
    }

    const tenantId = tenant.id;

    // CA-4: correo duplicado en el tenant -> mensaje claro, ninguna cuenta
    // nueva (ni en Auth, porque esta verificación ocurre ANTES de createUser()).
    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, email);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
    }

    // 1. Identidad en auth.users (sin iniciar sesión todavía) -- el MISMO
    // authIdentityService que usa el registro de Aliado (CA-2).
    const { userId } = await this.authIdentityService.createUser({ tenantId, email, password, role: 'CLIENT' });

    // 2. Todo lo posterior a crear la identidad debe compensarse (B3): un
    // fallo a mitad de camino no debe dejar un usuario de auth.users
    // huérfano ni una fila de usuario que haga fallar un reintento legítimo
    // con un falso 409 EMAIL_ALREADY_REGISTERED.
    let usuarioCreado = false;
    let clienteCreado = false;
    let tokens;

    try {
      // Espejo de negocio -- handle_new_user migrado explícitamente a Node.
      await this.usuarioRepository.create({ id: userId, tenantId, email, rol: 'CLIENT', estado: 'ACTIVE', phone });
      usuarioCreado = true;

      await this.clienteRepository.create({ tenantId, usuarioId: userId, tipo: 'PERSONA_NATURAL' });
      clienteCreado = true;

      // 3. Recién ahora la fila de usuario existe: autenticar emite claims correctos.
      tokens = await this.authIdentityService.authenticate({ tenantId, email, password });
    } catch (err) {
      if (clienteCreado) {
        await safeRun(() => this.clienteRepository.deleteByUsuarioId(tenantId, userId));
      }
      if (usuarioCreado) {
        await safeRun(() => this.usuarioRepository.deleteById(tenantId, userId));
      }
      await safeRun(() => this.authIdentityService.deleteUser(userId));
      throw err;
    }

    const profile = new Profile({
      id: userId,
      userId,
      role: 'CLIENT',
      fullName,
      status: 'VERIFIED',
      tenantId,
    });

    return { profile: profile.toJSON(), tokens };
  }
}

module.exports = RegisterClientNaturalPersonUseCase;
