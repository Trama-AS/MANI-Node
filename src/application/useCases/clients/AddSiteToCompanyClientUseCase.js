const Site = require('../../../domain/entities/Site');
const { ValidationError } = require('../../../domain/errors/DomainError');
const { assertClientOwnerOrAdmin, cargarCliente } = require('./clientAccess');

/**
 * Caso de Uso: Agregar Sitio a Cliente Empresa Existente (RF-08 / RF-09)
 * Permite a una empresa registrar nuevas sucursales o sedes de servicio bajo su perfil.
 */
class AddSiteToCompanyClientUseCase {
  /**
   * @param {import('../../../domain/ports/ICompanyClientRepository')} repository
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
    const { clienteId, tenantId, nombre, direccion, zonaId, contactoNombre, contactoTelefono, reglas, userId, userRole, correlationId = 'none' } = input;

    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    // Verificar que el cliente existe y pertenece al tenant (o resolver el de la sesión con `me`)
    const client = await cargarCliente(this.repository, { clienteId, tenantId, userId });

    // Autorización y verificación de propiedad dentro del tenant (DoD §9.3), con falla cerrada (T9)
    assertClientOwnerOrAdmin({
      client,
      userId,
      userRole,
      mensaje: 'No tiene permisos para modificar sedes de este cliente empresa',
    });

    // Construir y validar la entidad Site
    const site = new Site({
      tenantId,
      clienteId: client.id,
      nombre,
      direccion,
      zonaId,
      contactoNombre,
      contactoTelefono,
      reglas,
    });
    site.validate();

    const savedSite = await this.repository.addSite(client.id, tenantId, site);
    console.log(
      `[AddSiteToCompanyClientUseCase] Sitio "${savedSite.nombre}" agregado al cliente "${client.id}". Corr: ${correlationId}`
    );

    return savedSite;
  }
}

AddSiteToCompanyClientUseCase.AddSiteToCompanyClientUseCase = AddSiteToCompanyClientUseCase;
module.exports = AddSiteToCompanyClientUseCase;
