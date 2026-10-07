const { Site } = require('../domain/Site');

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
   * @param {string} [input.correlationId]
   * @returns {Promise<Site>}
   */
  async execute(input) {
    const { clienteId, tenantId, nombre, direccion, zonaId, reglas, correlationId = 'none' } = input;

    if (!clienteId) throw new Error('clienteId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');

    // Verificar que el cliente existe y pertenece al tenant
    const client = await this.repository.findById(clienteId, tenantId);
    if (!client) {
      throw new Error(`Cliente con ID "${clienteId}" no encontrado en tenant "${tenantId}".`);
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
