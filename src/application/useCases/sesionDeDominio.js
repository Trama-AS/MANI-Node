const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Helpers de los módulos M-10 y M-12 (tarifario, quejas, métricas y tenants). Cada dominio pasa su prefijo de código
 * (`MANI-TAR`, `MANI-QJA`...) para que el formato de error sea el único de T5: `{ error, code, correlationId }`.
 */
function dominio(prefijo) {
  const invalido = (mensaje) => new ValidationError(`${prefijo}-400: ${mensaje}`, `${prefijo}-400`);

  /** Contexto verificado del JWT (T4): tenant, usuario y rol nunca salen del cuerpo ni de cabeceras. */
  function sesion(user, roles, mensaje) {
    if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
      throw new UnauthorizedError(`${prefijo}-401: sesión requerida`, `${prefijo}-401`);
    }
    // El claim del administrador llega como ADMIN; ADMIN_TENANT se acepta por compatibilidad con el middleware.
    const role = user.role === 'ADMIN_TENANT' ? 'ADMIN' : user.role;
    if (!roles.includes(role)) throw new ForbiddenError(`${prefijo}-403: ${mensaje}`, `${prefijo}-403`);
    return { tenantId: user.tenantId, userId: user.userId, role };
  }

  function uuid(valor, campo) {
    if (!UUID_RE.test(String(valor || ''))) throw invalido(`${campo} no es un UUID válido`);
    return String(valor);
  }

  /** Fecha de calendario YYYY-MM-DD que existe (rechaza 2026-02-30). */
  function fecha(valor, campo) {
    const texto = typeof valor === 'string' ? valor.trim() : '';
    const d = new Date(`${texto}T00:00:00Z`);
    if (!FECHA_RE.test(texto) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) {
      throw invalido(`${campo} debe ser una fecha YYYY-MM-DD`);
    }
    return texto;
  }

  /** Texto opcional u obligatorio, recortado, con longitud acotada. */
  function texto(valor, campo, { min = 1, max, obligatorio = false }) {
    if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
      if (obligatorio) throw invalido(`${campo} es obligatorio`);
      return null;
    }
    if (typeof valor !== 'string') throw invalido(`${campo} debe ser texto`);
    const limpio = valor.trim();
    if ([...limpio].length < min || [...limpio].length > max) {
      throw invalido(`${campo} debe tener entre ${min} y ${max} caracteres`);
    }
    return limpio;
  }

  /** Periodo [desde, hasta] con ambas fechas inclusive y una duración máxima en días. */
  function periodo(query, maxDias) {
    const desde = fecha(query.desde, 'desde');
    const hasta = fecha(query.hasta, 'hasta');
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86400000 + 1;
    if (dias < 1) throw invalido('desde no puede ser posterior a hasta');
    if (dias > maxDias) throw invalido(`el periodo no puede superar ${maxDias} días`);
    return { desde, hasta };
  }

  return { invalido, sesion, uuid, fecha, texto, periodo };
}

module.exports = { dominio, UUID_RE };
