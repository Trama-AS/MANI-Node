const { ForbiddenError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Los tres tipos de aliado del SRS (RF-05), decisión de la PO en SCRUM-862.
const TIPOS_ALIADO = ['PERSONA_NATURAL', 'PERSONA_JURIDICA', 'EMPLEADO_DIRECTO'];
const MAX_PAGE_SIZE = 100;

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
  return { tenantId: session.tenantId, role: session.role };
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`MANI-DSP-400: ${field} debe ser un UUID válido`, 'MANI-DSP-400');
  }
  return value;
}

module.exports = { requireDispatchSession, requireUuid, TIPOS_ALIADO, MAX_PAGE_SIZE };
