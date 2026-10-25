const { ForbiddenError } = require('../../../domain/errors/DomainError');

const ROLES_ADMIN = ['ADMIN', 'ADMIN_TENANT'];
const ROLES_CLIENTE = ['CLIENT', 'CLIENTE'];

/**
 * Control de acceso a las sedes de un cliente empresa (SCRUM-852 C4 / SCRUM-1387, DoD §9.3).
 * Solo el propio cliente empresa o el admin de su tenant las consultan y modifican. El rol y el usuario
 * salen del JWT verificado (T4). Falla cerrada (T9): sin rol reconocido, sin usuario en el token o sin
 * dueño conocido del cliente, se rechaza en vez de dejar pasar.
 *
 * @param {object} params
 * @param {object} params.client   - Cliente empresa ya encontrado en el tenant
 * @param {string} [params.userId]
 * @param {string} [params.userRole]
 * @param {string} params.mensaje  - Motivo que se devuelve en el 403
 * @throws {ForbiddenError}
 */
function assertClientOwnerOrAdmin({ client, userId, userRole, mensaje }) {
  const rol = String(userRole || '').toUpperCase();
  if (ROLES_ADMIN.includes(rol)) return;
  if (ROLES_CLIENTE.includes(rol) && userId && client.usuarioId && client.usuarioId === userId) return;
  throw new ForbiddenError(mensaje, 'FORBIDDEN');
}

module.exports = { assertClientOwnerOrAdmin };
