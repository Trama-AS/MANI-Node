const crypto = require('crypto');
const { CompanyClient } = require('../domain/CompanyClient');
const { Site } = require('../domain/Site');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

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
   * @returns {Promise<{ client: CompanyClient, sites: Site[], temporaryPassword?: string, isNew: boolean }>}
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

    // 1. Validar o generar contraseña segura (Políticas DevOps §15: prohibido contraseñas hardcodeadas)
    let effectivePassword;
    if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        throw new ValidationError('password debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
      }
      effectivePassword = password;
    } else {
      effectivePassword = `Cli-${crypto.randomBytes(8).toString('hex')}!Aa1`;
    }

    // 2. Construir y validar la entidad CompanyClient (tipo normalizado a PERSONA_JURIDICA)
    const companyClient = new CompanyClient({
      tenantId,
      razonSocial,
      nit,
      email,
      telefono,
      nombreRepresentante,
      tipo: 'PERSONA_JURIDICA',
    });
    companyClient.validate();

    // 3. Construir y validar cada uno de los sitios asociados
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

    // 4. Comprobar existencia previa en el tenant (Prevenir duplicidad y exposición de datos, DoD §9.3)
    const existingByNit = await this.companyClientRepository.findByNitAndTenant(companyClient.nit, tenantId);
    if (existingByNit) {
      throw new ConflictError(
        'Ya existe un cliente empresa registrado con ese NIT en este tenant',
        'NIT_ALREADY_REGISTERED'
      );
    }

    const existingByEmail = await this.companyClientRepository.findByEmailAndTenant(companyClient.email, tenantId);
    if (existingByEmail) {
      throw new ConflictError(
        'Ya existe un cliente empresa registrado con ese email en este tenant',
        'EMAIL_ALREADY_REGISTERED'
      );
    }

    // 5. Crear identidad en Supabase Auth si el servicio de autenticación está inyectado
    let userId = null;
    if (this.authIdentityService) {
      try {
        const authUser = await this.authIdentityService.createUser({
          tenantId,
          email: companyClient.email,
          password: effectivePassword,
          role: 'CLIENT',
        });
        userId = authUser.userId;
      } catch (authErr) {
        if (authErr.code === 'EMAIL_ALREADY_REGISTERED') {
          throw new ConflictError(
            'Ya existe un usuario con ese email registrado en la plataforma',
            'EMAIL_ALREADY_REGISTERED'
          );
        }
        throw authErr;
      }
    }

    // 6. Guardar cliente y sus sitios en repositorio con compensación SAGA
    let result;
    try {
      result = await this.companyClientRepository.save(companyClient, siteEntities, { userId });
    } catch (saveErr) {
      if (userId && this.authIdentityService && typeof this.authIdentityService.deleteUser === 'function') {
        try {
          await this.authIdentityService.deleteUser(userId);
        } catch (cleanupErr) {
          console.error('[RegisterCompanyClientWithSitesUseCase] Error en compensación de usuario en Auth:', cleanupErr);
        }
      }
      throw saveErr;
    }

    return {
      client: result.client,
      sites: result.sites,
      temporaryPassword: password ? undefined : effectivePassword,
      isNew: true,
    };
  }
}

module.exports = { RegisterCompanyClientWithSitesUseCase };
