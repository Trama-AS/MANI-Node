const { ForbiddenError, NotFoundError } = require('../../../domain/errors/DomainError');

const ROLES_ADMIN = ['ADMIN', 'ADMIN_TENANT'];
const ROLES_CLIENTE = ['CLIENT', 'CLIENTE'];

/** Alias de ruta para el cliente empresa de la sesión: `/clients/me/sites` (SCRUM-1387). */
const CLIENTE_PROPIO = 'me';

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

/**
 * Busca el cliente empresa de la ruta dentro del tenant. Con `me` lo resuelve por el usuario del JWT (T4), para que el
 * front no tenga que conocer el id interno del cliente. Si no existe, o el usuario de la sesión no tiene cliente
 * empresa en ese tenant, responde 404 sin datos.
 *
 * @param {import('../../../domain/ports/ICompanyClientRepository')} repository
 * @param {object} params
 * @param {string} params.clienteId - Id del cliente o `me`
 * @param {string} params.tenantId
 * @param {string} [params.userId]
 * @returns {Promise<import('../../../domain/entities/CompanyClient')>}
 * @throws {NotFoundError}
 */
async function cargarCliente(repository, { clienteId, tenantId, userId }) {
  const propio = clienteId === CLIENTE_PROPIO;
  let client = null;
  if (!propio) {
    client = await repository.findById(clienteId, tenantId);
  } else if (userId) {
    client = await repository.findByUsuarioId(userId, tenantId);
  }
  if (!client) {
    const quien = propio ? 'de la sesión' : `con ID "${clienteId}"`;
    throw new NotFoundError(`Cliente empresa ${quien} no encontrado en tenant "${tenantId}".`, 'CLIENT_NOT_FOUND');
  }
  return client;
}

module.exports = { assertClientOwnerOrAdmin, cargarCliente, CLIENTE_PROPIO };
