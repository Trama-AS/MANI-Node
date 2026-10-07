const { CompanyClient } = require('../domain/CompanyClient');
const { Site } = require('../domain/Site');

/**
 * Caso de Uso: Registrar Cliente Empresa con Múltiples Sitios
 * (SCRUM-852 / US-02.2.2 / RF-08 / RF-09)
 *
 * Criterio de Aceptación:
 * Scenario 1: Alta con múltiples sitios.
 * Given acceso al formulario / endpoint de cliente empresa,
 * When registro la organización y dos o más sitios asociados,
 * Then ambos sitios quedan disponibles al crear solicitudes.
 */
class RegisterCompanyClientWithSitesUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en RegisterCompanyClientWithSitesUseCase');
    this.repository = repository;
  }

  /**
   * Ejecuta el registro de la empresa y sus sedes.
   *
   * @param {object} input
   * @param {string} input.tenantId
   * @param {string} input.razonSocial
   * @param {string} input.nit
   * @param {string} input.email
   * @param {string} [input.telefono]
   * @param {string} [input.nombreRepresentante]
   * @param {Array<{ nombre?: string, direccion: string, zonaId: string, reglas?: object }>} [input.sitios]
   * @param {string} [input.correlationId]
   * @returns {Promise<{ client: CompanyClient, sites: Site[], isNew: boolean }>}
   */
  async execute(input) {
    const {
      tenantId,
      razonSocial,
      nit,
      email,
      telefono,
      nombreRepresentante,
      sitios = [],
      correlationId = 'none',
    } = input;

    // 1. Construir y validar la entidad CompanyClient
    const companyClient = new CompanyClient({
      tenantId,
      razonSocial,
      nit,
      email,
      telefono,
      nombreRepresentante,
    });
    companyClient.validate();

    // 2. Construir y validar cada uno de los sitios asociados
    const siteEntities = sitios.map((s, index) => {
      const site = new Site({
        tenantId,
        nombre: s.nombre,
        direccion: s.direccion,
        zonaId: s.zonaId,
        reglas: s.reglas,
      });
      try {
        site.validate();
      } catch (err) {
        throw new Error(`Sitio #${index + 1} inválido: ${err.message}`);
      }
      return site;
    });

    // 3. Comprobar existencia previa en el tenant (Idempotencia / No duplicar)
    const existingByNit = await this.repository.findByNitAndTenant(companyClient.nit, tenantId);
    if (existingByNit) {
      console.log(
        `[RegisterCompanyClientUseCase] Empresa con NIT ${companyClient.nit} ya existe en tenant ${tenantId}. Retornando registro existente. Corr: ${correlationId}`
      );
      const existingSites = await this.repository.findSitesByClientId(existingByNit.id, tenantId);
      return {
        client: existingByNit,
        sites: existingSites,
        isNew: false,
      };
    }

    const existingByEmail = await this.repository.findByEmailAndTenant(companyClient.email, tenantId);
    if (existingByEmail) {
      console.log(
        `[RegisterCompanyClientUseCase] Empresa con email ${companyClient.email} ya existe en tenant ${tenantId}. Retornando registro existente. Corr: ${correlationId}`
      );
      const existingSites = await this.repository.findSitesByClientId(existingByEmail.id, tenantId);
      return {
        client: existingByEmail,
        sites: existingSites,
        isNew: false,
      };
    }

    // 4. Guardar cliente y sus sitios
    const result = await this.repository.save(companyClient, siteEntities);

    console.log(
      `[RegisterCompanyClientUseCase] Empresa "${companyClient.razonSocial}" registrada con ${result.sites.length} sitios en tenant ${tenantId}. Corr: ${correlationId}`
    );

    return {
      client: result.client,
      sites: result.sites,
      isNew: true,
    };
  }
}

module.exports = { RegisterCompanyClientWithSitesUseCase };
