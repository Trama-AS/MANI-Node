const { DomainError, ForbiddenError, ValidationError } = require('../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant sobre el que opera el administrador de plataforma. */
const HEADER_TENANT = 'x-mani-tenant';
/** Usuario del tenant con cuya identidad actúa el administrador de plataforma. */
const HEADER_ACTUAR_COMO = 'x-mani-actuar-como';

/** Rol del dominio para cada valor de `usuario.rol`. */
const ROL_DE_USUARIO = { CLIENTE: 'CLIENT', ALIADO: 'ALLY', ADMIN_TENANT: 'ADMIN' };

const rechazo = (mensaje, code = 'MANI-PLA-403') => new ForbiddenError(`${code}: ${mensaje}`, code);

/**
 * Contexto efectivo del administrador de plataforma (SCRUM-901, decisión de acceso total del 4-nov-2026).
 *
 * El permiso PLATFORM_ADMIN puede usar todas las funciones del sistema:
 * - Sin cabeceras, administra su propio tenant como un administrador de tenant.
 * - Con `X-Mani-Tenant`, administra ese tenant.
 * - Con `X-Mani-Actuar-Como` (un usuario del tenant elegido), actúa con la identidad de ese usuario: sus
 *   solicitudes, su cobertura, sus cobros. Así funcionan las pantallas de cliente y de aliado sin cambiar cada
 *   regla de negocio ni las políticas RLS, que siguen viendo un cliente, aliado o administrador real del tenant.
 *
 * La sesión resultante conserva `permisoPlataforma: true` (para las operaciones exclusivas de plataforma) y
 * `actor` con quién actuó de verdad, para la auditoría. Las cabeceras solo valen para PLATFORM_ADMIN: cualquier
 * otro rol que las envíe recibe 403 (fallo cerrado, T9).
 */
class ContextoPlataformaService {
  constructor({ repositorio = null, logger = console } = {}) {
    this.repositorio = repositorio;
    this.logger = logger;
  }

  static cabeceras(headers = {}) {
    const leer = (nombre) => {
      const v = headers[nombre];
      const texto = Array.isArray(v) ? v[0] : v;
      return typeof texto === 'string' && texto.trim() !== '' ? texto.trim() : null;
    };
    return { tenant: leer(HEADER_TENANT), actuarComo: leer(HEADER_ACTUAR_COMO) };
  }

  /**
   * Devuelve la sesión con la que se atiende la petición.
   * @param {object} session Sesión verificada del JWT ({ tenantId, userId, role, ... }).
   * @param {object} headers Cabeceras de la petición (en minúsculas, como las entrega Node).
   */
  async resolver(session, headers = {}, { correlationId = null, metodo = null, ruta = null } = {}) {
    const { tenant, actuarComo } = ContextoPlataformaService.cabeceras(headers);
    const esPlataforma = String(session.role || '').toUpperCase() === 'PLATFORM_ADMIN';

    if (!esPlataforma) {
      if (tenant || actuarComo) {
        throw rechazo('solo el administrador de plataforma puede elegir tenant o actuar como otro usuario');
      }
      return session;
    }

    const actor = { userId: session.userId, tenantId: session.tenantId, role: 'PLATFORM_ADMIN' };
    let tenantId = session.tenantId;

    if (tenant) {
      if (!UUID_RE.test(tenant)) {
        throw new ValidationError('MANI-PLA-400: X-Mani-Tenant debe ser un UUID', 'MANI-PLA-400');
      }
      const encontrado = await this._repo().obtenerTenant(tenant);
      if (!encontrado) throw new DomainError('MANI-PLA-404: el tenant no existe', 'MANI-PLA-404', 404);
      tenantId = tenant;
    }

    let efectiva = { ...session, tenantId, role: 'ADMIN', userId: session.userId };

    if (actuarComo) {
      if (!UUID_RE.test(actuarComo)) {
        throw new ValidationError('MANI-PLA-400: X-Mani-Actuar-Como debe ser un UUID', 'MANI-PLA-400');
      }
      const usuario = await this._repo().obtenerUsuario(tenantId, actuarComo);
      if (!usuario) {
        throw new DomainError('MANI-PLA-404: el usuario no existe en el tenant elegido', 'MANI-PLA-404', 404);
      }
      const rol = ROL_DE_USUARIO[String(usuario.rol || '').toUpperCase()];
      if (!rol) throw rechazo('no se puede actuar como otro administrador de plataforma');
      efectiva = { ...session, tenantId, userId: usuario.id, role: rol, email: usuario.email };
    }

    efectiva.permisoPlataforma = true;
    efectiva.actor = actor;

    if (tenant || actuarComo) {
      // Auditoría de cada operación hecha en nombre de otro tenant o usuario.
      this.logger.info?.(
        JSON.stringify({
          evento: 'PLATAFORMA_CONTEXTO',
          correlationId,
          metodo,
          ruta,
          actor: actor.userId,
          tenantEfectivo: efectiva.tenantId,
          usuarioEfectivo: efectiva.userId,
          rolEfectivo: efectiva.role,
        })
      );
    }
    return efectiva;
  }

  _repo() {
    if (!this.repositorio) {
      throw new DomainError(
        'MANI-SRV-503: la base de datos no está configurada (DATABASE_URL)',
        'SERVICE_UNAVAILABLE',
        503
      );
    }
    return this.repositorio;
  }
}

/** true si la sesión tiene el permiso de plataforma, aunque actúe con otro rol. */
function tienePermisoPlataforma(user) {
  return Boolean(user && (user.permisoPlataforma || String(user.role || '').toUpperCase() === 'PLATFORM_ADMIN'));
}

const ROLES_DE_PLATAFORMA = new Set(['PLATFORM_ADMIN', 'ADMIN_PLATAFORMA']);

module.exports = {
  ContextoPlataformaService,
  tienePermisoPlataforma,
  ROLES_DE_PLATAFORMA,
  HEADER_TENANT,
  HEADER_ACTUAR_COMO,
};
