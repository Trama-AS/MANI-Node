const { CompanyClient } = require('../domain/CompanyClient');
const { Site } = require('../domain/Site');
const { ValidationError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Registrar Cliente Empresa con Múltiples Sitios
 * (SCRUM-852 / US-02.2.2 / RF-08 / RF-09)
 */
class RegisterCompanyClientWithSitesUseCase {
  /**
   * @param {object|import('./ICompanyClientRepository').ICompanyClientRepository} dependenciesOrRepo
   */
  constructor(dependenciesOrRepo) {
    if (!dependenciesOrRepo) {
      throw new Error('companyClientRepository es requerido en RegisterCompanyClientWithSitesUseCase');
    }

    if (typeof dependenciesOrRepo.save === 'function') {
      this.companyClientRepository = dependenciesOrRepo;
    } else {
      this.companyClientRepository = dependenciesOrRepo.companyClientRepository;
      this.authIdentityService = dependenciesOrRepo.authIdentityService;
      this.tenantRepository = dependenciesOrRepo.tenantRepository;
    }

    if (!this.companyClientRepository) {
      throw new Error('companyClientRepository es requerido en RegisterCompanyClientWithSitesUseCase');
    }
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
   * @param {string} [input.password]
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
      password,
      sitios = [],
    } = input || {};

    if (!tenantId) {
      throw new ValidationError('tenantId es requerido para registrar un cliente empresa', 'VALIDATION_ERROR');
    }

    if (this.tenantRepository) {
      const tenant = await this.tenantRepository.findById(tenantId);
      if (!tenant) {
        throw new ValidationError(`El tenant ${tenantId} no existe`, 'TENANT_NOT_FOUND');
      }
    }

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
    const siteEntities = (sitios || []).map((s, index) => {
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
        throw new ValidationError(`Sitio #${index + 1} inválido: ${err.message}`, 'VALIDATION_ERROR');
      }
      return site;
    });

    // 3. Comprobar existencia previa en el tenant (Idempotencia / No duplicar)
    const existingByNit = await this.companyClientRepository.findByNitAndTenant(companyClient.nit, tenantId);
    if (existingByNit) {
      const existingSites = await this.companyClientRepository.findSitesByClientId(existingByNit.id, tenantId);
      return {
        client: existingByNit,
        sites: existingSites,
        isNew: false,
      };
    }

    const existingByEmail = await this.companyClientRepository.findByEmailAndTenant(companyClient.email, tenantId);
    if (existingByEmail) {
      const existingSites = await this.companyClientRepository.findSitesByClientId(existingByEmail.id, tenantId);
      return {
        client: existingByEmail,
        sites: existingSites,
        isNew: false,
      };
    }

    // 4. Crear identidad en Supabase Auth si el servicio de autenticación está inyectado
    let userId = null;
    if (this.authIdentityService) {
      const effectivePassword = password || 'ManiClient2026!';
      try {
        const authUser = await this.authIdentityService.createUser({
          tenantId,
          email: companyClient.email,
          password: effectivePassword,
          role: 'CLIENT',
        });
        userId = authUser.userId;
      } catch (authErr) {
        // Si el usuario ya existe en Supabase Auth (e.g. creado previamente), se continúa
        if (authErr.code !== 'EMAIL_ALREADY_REGISTERED') {
          throw authErr;
        }
      }
    }

    // 5. Guardar cliente y sus sitios en repositorio
    const result = await this.companyClientRepository.save(companyClient, siteEntities, { userId });

    return {
      client: result.client,
      sites: result.sites,
      isNew: true,
    };
  }
}

module.exports = { RegisterCompanyClientWithSitesUseCase };
