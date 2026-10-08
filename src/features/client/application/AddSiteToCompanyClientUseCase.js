const { Site } = require('../domain/Site');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Agregar Sitio a Cliente Empresa Existente (RF-08 / RF-09)
 * Permite a una empresa registrar nuevas sucursales o sedes de servicio bajo su perfil.
 */
class AddSiteToCompanyClientUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en AddSiteToCompanyClientUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.clienteId
   * @param {string} input.tenantId
   * @param {string} [input.nombre]
   * @param {string} input.direccion
   * @param {string} input.zonaId
   * @param {object} [input.reglas]
   * @param {string} [input.userId]
   * @param {string} [input.userRole]
   * @param {string} [input.correlationId]
   * @returns {Promise<Site>}
   */
  async execute(input) {
    const { clienteId, tenantId, nombre, direccion, zonaId, reglas, userId, userRole, correlationId = 'none' } = input;

    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    // Verificar que el cliente existe y pertenece al tenant
    const client = await this.repository.findById(clienteId, tenantId);
    if (!client) {
      throw new NotFoundError(`Cliente con ID "${clienteId}" no encontrado en tenant "${tenantId}".`, 'CLIENT_NOT_FOUND');
    }

    // Autorización y verificación de propiedad dentro del tenant (DoD §9.3)
    const normalizedRole = (userRole || '').toUpperCase();
    const isAdmin = ['ADMIN', 'ADMIN_TENANT'].includes(normalizedRole);
    if (!isAdmin && userId && client.usuarioId && client.usuarioId !== userId) {
      throw new ForbiddenError('No tiene permisos para modificar sedes de este cliente empresa', 'FORBIDDEN');
    }

    // Construir y validar la entidad Site
    const site = new Site({
      tenantId,
      clienteId,
      nombre,
      direccion,
      zonaId,
      reglas,
    });
    site.validate();

    const savedSite = await this.repository.addSite(clienteId, tenantId, site);
    console.log(
      `[AddSiteToCompanyClientUseCase] Sitio "${savedSite.nombre}" agregado al cliente "${clienteId}". Corr: ${correlationId}`
    );

    return savedSite;
  }
}

module.exports = { AddSiteToCompanyClientUseCase };
