const { ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * Control de acceso a la sede (SCRUM-853 / RF-09, DoD §9.3): solo el cliente dueño de la sede o el admin
 * del tenant la gestionan y leen sus reglas. El rol y el usuario salen del JWT (`authenticate`).
 *
 * El aliado asignado a una solicitud del sitio también debe poder leer las reglas (criterio C2), pero la
 * asignación todavía no está en Core (MANI-.NET#1 depende de MANI-Node#43). Hasta entonces se le niega:
 * negar es lo seguro, porque las reglas incluyen instrucciones y contacto de acceso al inmueble.
 *
 * @param {object} params
 * @param {object} params.site          - Sede ya encontrada en el tenant
 * @param {string} params.tenantId
 * @param {string} [params.userId]
 * @param {string} [params.role]        - CLIENT | ALLY | ADMIN
 * @param {object} [params.clientRepository] - Resuelve el usuario dueño del cliente de la sede
 * @param {string} params.mensaje       - Motivo que se devuelve en el 403
 * @throws {ForbiddenError}
 */
async function assertSiteOwnerOrAdmin({ site, tenantId, userId, role, clientRepository, mensaje }) {
  if (role === 'ADMIN') return;
  if (role === 'CLIENT' && userId && clientRepository) {
    const duenoId = await clientRepository.findUsuarioIdByClientId(tenantId, site.clientId || site.clienteId);
    if (duenoId === userId) return;
  }
  throw new ForbiddenError(mensaje, 'FORBIDDEN');
}

module.exports = { assertSiteOwnerOrAdmin };
