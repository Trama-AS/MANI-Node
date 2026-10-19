const InMemoryTenantRepository = require('./infrastructure/repositories/InMemoryTenantRepository');
const SupabaseTenantRepository = require('./infrastructure/repositories/SupabaseTenantRepository');
const InMemoryProfileRepository = require('./infrastructure/repositories/InMemoryProfileRepository');
const SupabaseProfileRepository = require('./infrastructure/repositories/SupabaseProfileRepository');
const InMemoryCatalogRepository = require('./infrastructure/repositories/InMemoryCatalogRepository');
const SupabaseCatalogRepository = require('./infrastructure/repositories/SupabaseCatalogRepository');
const InMemoryUsuarioRepository = require('./infrastructure/repositories/InMemoryUsuarioRepository');
const InMemoryAliadoRepository = require('./infrastructure/repositories/InMemoryAliadoRepository');
const InMemoryAliadoCategoriaRepository = require('./infrastructure/repositories/InMemoryAliadoCategoriaRepository');
const InMemoryDocumentoKycRepository = require('./infrastructure/repositories/InMemoryDocumentoKycRepository');
const InMemoryClienteRepository = require('./infrastructure/repositories/InMemoryClienteRepository');
const InMemorySitioRepository = require('./infrastructure/repositories/InMemorySitioRepository');
const SupabaseUsuarioRepository = require('./infrastructure/repositories/SupabaseUsuarioRepository');
const SupabaseAliadoRepository = require('./infrastructure/repositories/SupabaseAliadoRepository');
const SupabaseAliadoCategoriaRepository = require('./infrastructure/repositories/SupabaseAliadoCategoriaRepository');
const SupabaseDocumentoKycRepository = require('./infrastructure/repositories/SupabaseDocumentoKycRepository');
const SupabaseClienteRepository = require('./infrastructure/repositories/SupabaseClienteRepository');
const SupabaseSitioRepository = require('./infrastructure/repositories/SupabaseSitioRepository');
const InMemoryAliadoAusenciaRepository = require('./infrastructure/repositories/InMemoryAliadoAusenciaRepository');
const SupabaseAliadoAusenciaRepository = require('./infrastructure/repositories/SupabaseAliadoAusenciaRepository');
const TokenService = require('./infrastructure/security/TokenService');
const InMemoryAuthIdentityService = require('./infrastructure/security/InMemoryAuthIdentityService');
const SupabaseAuthIdentityService = require('./infrastructure/security/SupabaseAuthIdentityService');
const InMemoryFileStorageService = require('./infrastructure/security/InMemoryFileStorageService');
const SupabaseFileStorageService = require('./infrastructure/security/SupabaseFileStorageService');
const TransactionalAliadoCategoriaRepository = require('./infrastructure/repositories/TransactionalAliadoCategoriaRepository');
const SupabaseClientFactory = require('./infrastructure/db/SupabaseClientFactory');
const PgPoolFactory = require('./infrastructure/db/PgPoolFactory');
const SupabaseConnectionChecker = require('./infrastructure/db/SupabaseConnectionChecker');

const ListTenantsUseCase = require('./application/useCases/tenants/ListTenantsUseCase');
const GetOwnProfileUseCase = require('./application/useCases/profiles/GetOwnProfileUseCase');
const GetAllyCategoriesUseCase = require('./application/useCases/profiles/GetAllyCategoriesUseCase');
const DeclareAllyCategoriesUseCase = require('./application/useCases/profiles/DeclareAllyCategoriesUseCase');
const ListAvailableAllyCategoriesUseCase = require('./application/useCases/profiles/ListAvailableAllyCategoriesUseCase');
const ListCatalogCategoriesUseCase = require('./application/useCases/catalog/ListCatalogCategoriesUseCase');
const CheckHealthUseCase = require('./application/useCases/health/CheckHealthUseCase');
const RegisterAllyNaturalPersonUseCase = require('./application/useCases/auth/RegisterAllyNaturalPersonUseCase');
const RegisterCompanyClientWithSitesUseCase = require('./application/useCases/clients/RegisterCompanyClientWithSitesUseCase');
const AddSiteToCompanyClientUseCase = require('./application/useCases/clients/AddSiteToCompanyClientUseCase');
const GetCompanyClientSitesUseCase = require('./application/useCases/clients/GetCompanyClientSitesUseCase');
const InMemoryCompanyClientRepository = require('./infrastructure/repositories/InMemoryCompanyClientRepository');
const PostgresCompanyClientRepository = require('./infrastructure/repositories/PostgresCompanyClientRepository');
const RegisterDirectEmployeeUseCase = require('./application/useCases/allies/RegisterDirectEmployeeUseCase');
const RegisterClientNaturalPersonUseCase = require('./application/useCases/auth/RegisterClientNaturalPersonUseCase');
const ListAllyAbsencesUseCase = require('./application/useCases/availability/ListAllyAbsencesUseCase');
const CreateAllyAbsenceUseCase = require('./application/useCases/availability/CreateAllyAbsenceUseCase');
const UpdateAllyAbsenceUseCase = require('./application/useCases/availability/UpdateAllyAbsenceUseCase');
const DeleteAllyAbsenceUseCase = require('./application/useCases/availability/DeleteAllyAbsenceUseCase');

const InMemoryCotizacionRepository = require('./infrastructure/repositories/InMemoryCotizacionRepository');
const PgCotizacionRepository = require('./infrastructure/repositories/PgCotizacionRepository');
const InMemorySolicitudRepository = require('./infrastructure/repositories/InMemorySolicitudRepository');
const PgSolicitudRepository = require('./infrastructure/repositories/PgSolicitudRepository');
const InMemoryEventoServicioRepository = require('./infrastructure/repositories/InMemoryEventoServicioRepository');
const PgEventoServicioRepository = require('./infrastructure/repositories/PgEventoServicioRepository');

const CreateQuoteUseCase = require('./application/useCases/quotes/CreateQuoteUseCase');
const RespondQuoteUseCase = require('./application/useCases/quotes/RespondQuoteUseCase');
const ExecutionLifecycleUseCase = require('./application/useCases/services/ExecutionLifecycleUseCase');
const RegisterServiceEventUseCase = require('./application/useCases/services/RegisterServiceEventUseCase');
const GetServiceLogUseCase = require('./application/useCases/services/GetServiceLogUseCase');
const GetClientServicesHistoryUseCase = require('./application/useCases/services/GetClientServicesHistoryUseCase');
const PgServiceRequestRepository = require('./infrastructure/repositories/PgServiceRequestRepository');
const CreateServiceRequestUseCase = require('./application/useCases/requests/CreateServiceRequestUseCase');

const config = require('./config');

class Container {
  constructor() {
    // 1. Instancias de Infraestructura (Adaptadores Secundarios)
    this.tokenService = new TokenService();

    this.supabaseClientFactory = new SupabaseClientFactory({
      supabaseUrl: config.supabaseUrl,
      supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    });
    this.pgPoolFactory = new PgPoolFactory({ databaseUrl: config.databaseUrl });
    this.supabaseConnectionChecker = new SupabaseConnectionChecker({
      supabaseClientFactory: this.supabaseClientFactory,
    });

    // Con Supabase configurado (QA/producción) se usa la persistencia e identidad
    // reales; sin configurar (DEV/test sin credenciales) cae a implementaciones
    // en memoria, igual que ya hacía el resto del container.
    if (this.supabaseClientFactory.isConfigured()) {
      this.profileRepository = new SupabaseProfileRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.tenantRepository = new SupabaseTenantRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.catalogRepository = new SupabaseCatalogRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.usuarioRepository = new SupabaseUsuarioRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.aliadoRepository = new SupabaseAliadoRepository({ supabaseClientFactory: this.supabaseClientFactory });
      const supabaseAliadoCategoriaRepository = new SupabaseAliadoCategoriaRepository({
        supabaseClientFactory: this.supabaseClientFactory,
      });
      // Con DATABASE_URL el guardado de categorías es una transacción real (SCRUM-1071).
      // QA y producción la exigen (config.assertValid); en DEV sin ella se conserva el
      // guardado de supabase-js, que NO es atómico.
      if (this.pgPoolFactory.isConfigured()) {
        this.aliadoCategoriaRepository = new TransactionalAliadoCategoriaRepository({
          pgPoolFactory: this.pgPoolFactory,
          delegate: supabaseAliadoCategoriaRepository,
        });
      } else {
        console.warn('⚠️  DATABASE_URL no configurada: el guardado de categorías del aliado no es atómico.');
        this.aliadoCategoriaRepository = supabaseAliadoCategoriaRepository;
      }
      this.documentoKycRepository = new SupabaseDocumentoKycRepository({
        supabaseClientFactory: this.supabaseClientFactory,
      });
      this.clienteRepository = new SupabaseClienteRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.sitioRepository = new SupabaseSitioRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.aliadoAusenciaRepository = new SupabaseAliadoAusenciaRepository({
        supabaseClientFactory: this.supabaseClientFactory,
      });
      this.fileStorageService = new SupabaseFileStorageService({ supabaseClientFactory: this.supabaseClientFactory });
      this.authIdentityService = new SupabaseAuthIdentityService({
        supabaseClientFactory: this.supabaseClientFactory,
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      });
      if (this.pgPoolFactory.isConfigured()) {
        this.companyClientRepository = new PostgresCompanyClientRepository({ pgPoolFactory: this.pgPoolFactory });
      } else {
        this.companyClientRepository = new InMemoryCompanyClientRepository();
      }
    } else {
      this.profileRepository = new InMemoryProfileRepository();
      this.tenantRepository = new InMemoryTenantRepository();
      this.catalogRepository = new InMemoryCatalogRepository();
      this.usuarioRepository = new InMemoryUsuarioRepository();
      this.aliadoRepository = new InMemoryAliadoRepository();
      this.aliadoCategoriaRepository = new InMemoryAliadoCategoriaRepository();
      this.documentoKycRepository = new InMemoryDocumentoKycRepository();
      this.clienteRepository = new InMemoryClienteRepository();
      this.sitioRepository = new InMemorySitioRepository();
      this.aliadoAusenciaRepository = new InMemoryAliadoAusenciaRepository();
      this.fileStorageService = new InMemoryFileStorageService();
      this.authIdentityService = new InMemoryAuthIdentityService({ jwtSecret: config.supabaseJwtSecret });
      this.companyClientRepository = new InMemoryCompanyClientRepository();
    }

    // 2. Instancias de Aplicación (Casos de Uso) con Dependencias Inyectadas (DIP)
    // Cotización y ciclo de vida del servicio (SCRUM-865 en adelante): sobre `pg` con el contexto de tenant
    // (withTenantContext, ADR-0032). Sin DATABASE_URL (DEV/test) se usan adaptadores en memoria.
    if (this.pgPoolFactory.isConfigured()) {
      this.cotizacionRepository = new PgCotizacionRepository({ pgPoolFactory: this.pgPoolFactory });
      this.solicitudRepository = new PgSolicitudRepository({ pgPoolFactory: this.pgPoolFactory });
      this.eventoServicioRepository = new PgEventoServicioRepository({ pgPoolFactory: this.pgPoolFactory });
    } else {
      this.cotizacionRepository = new InMemoryCotizacionRepository();
      this.solicitudRepository = new InMemorySolicitudRepository();
      this.eventoServicioRepository = new InMemoryEventoServicioRepository();
    }

    this.createQuoteUseCase = new CreateQuoteUseCase({
      cotizacionRepository: this.cotizacionRepository,
      solicitudRepository: this.solicitudRepository,
      eventoServicioRepository: this.eventoServicioRepository,
      aliadoRepository: this.aliadoRepository,
    });

    this.respondQuoteUseCase = new RespondQuoteUseCase({
      cotizacionRepository: this.cotizacionRepository,
      solicitudRepository: this.solicitudRepository,
      eventoServicioRepository: this.eventoServicioRepository,
      clienteRepository: this.clienteRepository,
    });

    this.executionLifecycleUseCase = new ExecutionLifecycleUseCase({
      solicitudRepository: this.solicitudRepository,
      eventoServicioRepository: this.eventoServicioRepository,
      aliadoRepository: this.aliadoRepository,
    });

    this.registerServiceEventUseCase = new RegisterServiceEventUseCase({
      solicitudRepository: this.solicitudRepository,
      eventoServicioRepository: this.eventoServicioRepository,
      aliadoRepository: this.aliadoRepository,
      fileStorageService: this.fileStorageService,
    });

    this.getServiceLogUseCase = new GetServiceLogUseCase({
      solicitudRepository: this.solicitudRepository,
      eventoServicioRepository: this.eventoServicioRepository,
      clienteRepository: this.clienteRepository,
      aliadoRepository: this.aliadoRepository,
    });

    this.getClientServicesHistoryUseCase = new GetClientServicesHistoryUseCase({
      solicitudRepository: this.solicitudRepository,
      cotizacionRepository: this.cotizacionRepository,
      clienteRepository: this.clienteRepository,
    });

    this.listTenantsUseCase = new ListTenantsUseCase({
      tenantRepository: this.tenantRepository,
    });

    this.getOwnProfileUseCase = new GetOwnProfileUseCase({
      profileRepository: this.profileRepository,
    });

    this.getAllyCategoriesUseCase = new GetAllyCategoriesUseCase({
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
    });

    this.declareAllyCategoriesUseCase = new DeclareAllyCategoriesUseCase({
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
    });

    this.listAvailableAllyCategoriesUseCase = new ListAvailableAllyCategoriesUseCase({
      aliadoRepository: this.aliadoRepository,
      catalogRepository: this.catalogRepository,
    });

    const absenceDeps = {
      aliadoRepository: this.aliadoRepository,
      aliadoAusenciaRepository: this.aliadoAusenciaRepository,
    };
    this.listAllyAbsencesUseCase = new ListAllyAbsencesUseCase(absenceDeps);
    this.createAllyAbsenceUseCase = new CreateAllyAbsenceUseCase(absenceDeps);
    this.updateAllyAbsenceUseCase = new UpdateAllyAbsenceUseCase(absenceDeps);
    this.deleteAllyAbsenceUseCase = new DeleteAllyAbsenceUseCase(absenceDeps);

    this.listCatalogCategoriesUseCase = new ListCatalogCategoriesUseCase({
      catalogRepository: this.catalogRepository,
    });

    // Creación de solicitudes (SCRUM-1072): transacción sobre `pg` con withTenantContext (ADR-0032).
    // Sin DATABASE_URL no hay respaldo en memoria: responde 503.
    this.serviceRequestRepository = new PgServiceRequestRepository({ pgPoolFactory: this.pgPoolFactory });
    this.createServiceRequestUseCase = new CreateServiceRequestUseCase({
      serviceRequestRepository: this.serviceRequestRepository,
      fileStorageService: this.fileStorageService,
    });

    this.checkHealthUseCase = new CheckHealthUseCase({
      supabaseConnectionChecker: this.supabaseConnectionChecker,
      envLabel: config.envLabel,
    });

    this.registerCompanyClientWithSitesUseCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: this.companyClientRepository,
      authIdentityService: this.authIdentityService,
      tenantRepository: this.tenantRepository,
    });

    this.addSiteToCompanyClientUseCase = new AddSiteToCompanyClientUseCase(this.companyClientRepository);

    this.getCompanyClientSitesUseCase = new GetCompanyClientSitesUseCase(this.companyClientRepository);

    this.registerAllyNaturalPersonUseCase = new RegisterAllyNaturalPersonUseCase({
      tenantRepository: this.tenantRepository,
      catalogRepository: this.catalogRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      documentoKycRepository: this.documentoKycRepository,
      fileStorageService: this.fileStorageService,
      authIdentityService: this.authIdentityService,
    });

    this.registerDirectEmployeeUseCase = new RegisterDirectEmployeeUseCase({
      tenantRepository: this.tenantRepository,
      catalogRepository: this.catalogRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      authIdentityService: this.authIdentityService,
    });

    // CA-2: reutiliza tenantRepository, usuarioRepository y authIdentityService
    // -- las MISMAS instancias que RegisterAllyNaturalPersonUseCase, no copias.
    this.registerClientNaturalPersonUseCase = new RegisterClientNaturalPersonUseCase({
      tenantRepository: this.tenantRepository,
      usuarioRepository: this.usuarioRepository,
      clienteRepository: this.clienteRepository,
      sitioRepository: this.sitioRepository,
      authIdentityService: this.authIdentityService,
    });
  }
}

const container = new Container();

module.exports = container;
