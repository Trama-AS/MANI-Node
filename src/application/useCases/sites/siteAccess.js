const { ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * Control de acceso a la sede (SCRUM-853 / RF-09, DoD §9.3): solo el cliente dueño de la sede o el admin
 * del tenant la gestionan. El rol y el usuario salen del JWT (`authenticate`). La lectura de reglas suma al
 * aliado asignado a una solicitud del sitio, que verifica GetSiteRulesForAllyUseCase con Dispatch.
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
