const { ForbiddenError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Los tres tipos de aliado del SRS (RF-05), decisión de la PO en SCRUM-862.
const TIPOS_ALIADO = ['PERSONA_NATURAL', 'PERSONA_JURIDICA', 'EMPLEADO_DIRECTO'];
const MAX_PAGE_SIZE = 100;
const MAX_EXCLUIDOS = 100;

/**
 * Dispatch actúa en nombre del cliente o del administrador del tenant que originó la solicitud: un aliado
 * no consulta la elegibilidad ni publica ofertas (misma restricción de rol que Dispatch aplica al orquestar).
 * El tenant y el rol salen siempre del JWT verificado, nunca del cuerpo ni de cabeceras.
 */
function requireDispatchSession(session = {}) {
  if (!session.tenantId) {
    throw new ForbiddenError('MANI-DSP-403: la sesión no tiene un tenant', 'MANI-DSP-403');
  }
  if (session.role !== 'CLIENT' && session.role !== 'ADMIN') {
    throw new ForbiddenError('MANI-DSP-403: el rol no puede usar esta operación', 'MANI-DSP-403');
  }
  return { tenantId: session.tenantId, userId: session.userId, role: session.role };
}

/**
 * El contexto de una solicitud lo leen el cliente dueño, el admin del tenant y el aliado asignado o con oferta
 * (Dispatch lo pide con el token que reenvía al orquestar o al rechazar). Cuál de ellos la ve lo decide el
 * repositorio; aquí solo se exige un rol del ciclo del servicio y un usuario identificado.
 */
function requireContextSession(session = {}) {
  if (!session.tenantId) {
    throw new ForbiddenError('MANI-DSP-403: la sesión no tiene un tenant', 'MANI-DSP-403');
  }
  if (!['CLIENT', 'ADMIN', 'ALLY'].includes(session.role)) {
    throw new ForbiddenError('MANI-DSP-403: el rol no puede usar esta operación', 'MANI-DSP-403');
  }
  if (typeof session.userId !== 'string' || !UUID_RE.test(session.userId)) {
    throw new ForbiddenError('MANI-DSP-403: la sesión no identifica al usuario', 'MANI-DSP-403');
  }
  return { tenantId: session.tenantId, userId: session.userId, role: session.role };
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`MANI-DSP-400: ${field} debe ser un UUID válido`, 'MANI-DSP-400');
  }
  return value;
}

/** Lista de UUID separados por coma (`?excludeAllyIds=a,b`); vacía si no llega. */
function uuidList(value, field, max) {
  if (value === undefined || value === null || value === '') return [];
  const items = String(value)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (items.length > max) {
    throw new ValidationError(`MANI-DSP-400: ${field} admite como máximo ${max} identificadores`, 'MANI-DSP-400');
  }
  items.forEach((v) => requireUuid(v, field));
  return [...new Set(items.map((v) => v.toLowerCase()))];
}

function positiveInt(value, field, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || (max && n > max)) {
    throw new ValidationError(`MANI-DSP-400: ${field} debe ser un entero entre 1 y ${max || 'el máximo'}`, 'MANI-DSP-400');
  }
  return n;
}

// Filtro opcional de tipo de aliado: vacío es «todos»; cualquier otro valor debe ser uno de los tres tipos.
function tipoOpcional(value) {
  const tipoPedido = value === undefined || value === null ? '' : String(value).trim();
  if (tipoPedido === '') return null;
  const tipo = tipoPedido.toUpperCase();
  if (!TIPOS_ALIADO.includes(tipo)) {
    throw new ValidationError(`MANI-DSP-400: tipo debe ser uno de ${TIPOS_ALIADO.join(', ')}`, 'MANI-DSP-400');
  }
  return tipo;
}

// Página del listado de elegibles: `page` desde 1 y `pageSize` de 1 a MAX_PAGE_SIZE (20 por omisión).
function paginaElegibles(query = {}) {
  return {
    page: positiveInt(query.page, 'page', 1),
    pageSize: positiveInt(query.pageSize, 'pageSize', 20, MAX_PAGE_SIZE),
  };
}

module.exports = {
  requireDispatchSession,
  requireContextSession,
  requireUuid,
  uuidList,
  tipoOpcional,
  paginaElegibles,
  TIPOS_ALIADO,
  MAX_PAGE_SIZE,
  MAX_EXCLUIDOS,
};
