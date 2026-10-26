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
const TransactionalAliadoRepository = require('./infrastructure/repositories/TransactionalAliadoRepository');
const SupabaseClientFactory = require('./infrastructure/db/SupabaseClientFactory');
const PgPoolFactory = require('./infrastructure/db/PgPoolFactory');
const SupabaseConnectionChecker = require('./infrastructure/db/SupabaseConnectionChecker');
const RulesServiceHttpClient = require('./infrastructure/clients/RulesServiceHttpClient');
const DispatchServiceHttpClient = require('./infrastructure/clients/DispatchServiceHttpClient');

const ListTenantsUseCase = require('./application/useCases/tenants/ListTenantsUseCase');
const GetOwnProfileUseCase = require('./application/useCases/profiles/GetOwnProfileUseCase');
const UpdateOwnProfileUseCase = require('./application/useCases/profiles/UpdateOwnProfileUseCase');
const GetAllyCategoriesUseCase = require('./application/useCases/profiles/GetAllyCategoriesUseCase');
const DeclareAllyCategoriesUseCase = require('./application/useCases/profiles/DeclareAllyCategoriesUseCase');
const ListAvailableAllyCategoriesUseCase = require('./application/useCases/profiles/ListAvailableAllyCategoriesUseCase');
const ListCatalogCategoriesUseCase = require('./application/useCases/catalog/ListCatalogCategoriesUseCase');
const ListCategoriesForTenantUseCase = require('./application/useCases/catalog/ListCategoriesForTenantUseCase');
const GetCategoryUseCase = require('./application/useCases/catalog/GetCategoryUseCase');
const CreateCategoryUseCase = require('./application/useCases/catalog/CreateCategoryUseCase');
const UpdateCategoryUseCase = require('./application/useCases/catalog/UpdateCategoryUseCase');
const SetCategoryStatusUseCase = require('./application/useCases/catalog/SetCategoryStatusUseCase');
const CheckHealthUseCase = require('./application/useCases/health/CheckHealthUseCase');
const RegisterAllyNaturalPersonUseCase = require('./application/useCases/auth/RegisterAllyNaturalPersonUseCase');
const ListAlliesVerificationUseCase = require('./application/useCases/verification/ListAlliesVerificationUseCase');
const GetAllyVerificationDetailUseCase = require('./application/useCases/verification/GetAllyVerificationDetailUseCase');
const GetKycDocumentSignedUrlUseCase = require('./application/useCases/verification/GetKycDocumentSignedUrlUseCase');
const ResolveAllyVerificationUseCase = require('./application/useCases/verification/ResolveAllyVerificationUseCase');
const ConfigureSiteRulesUseCase = require('./application/useCases/sites/ConfigureSiteRulesUseCase');
const GetSiteRulesForAllyUseCase = require('./application/useCases/sites/GetSiteRulesForAllyUseCase');
const ValidateAllyScheduleUseCase = require('./application/useCases/sites/ValidateAllyScheduleUseCase');
const InMemorySiteRepository = require('./infrastructure/repositories/InMemorySiteRepository');
const PostgresSiteRepository = require('./infrastructure/repositories/PostgresSiteRepository');
const InMemoryClientRepository = require('./infrastructure/repositories/InMemoryClientRepository');
const PostgresClientRepository = require('./infrastructure/repositories/PostgresClientRepository');
const GetActiveLegalDocumentsUseCase = require('./application/useCases/legal/GetActiveLegalDocumentsUseCase');
const RegisterUserConsentUseCase = require('./application/useCases/legal/RegisterUserConsentUseCase');
const InMemoryLegalDocumentRepository = require('./infrastructure/repositories/InMemoryLegalDocumentRepository');
const SupabaseLegalDocumentRepository = require('./infrastructure/repositories/SupabaseLegalDocumentRepository');
const InMemoryUserConsentRepository = require('./infrastructure/repositories/InMemoryUserConsentRepository');
const SupabaseUserConsentRepository = require('./infrastructure/repositories/SupabaseUserConsentRepository');
const RegisterAllyCompanyUseCase = require('./application/useCases/auth/RegisterAllyCompanyUseCase');
const RegisterCompanyClientWithSitesUseCase = require('./application/useCases/clients/RegisterCompanyClientWithSitesUseCase');
const AddSiteToCompanyClientUseCase = require('./application/useCases/clients/AddSiteToCompanyClientUseCase');
const GetCompanyClientSitesUseCase = require('./application/useCases/clients/GetCompanyClientSitesUseCase');
const UpdateCompanyClientSiteUseCase = require('./application/useCases/clients/UpdateCompanyClientSiteUseCase');
const InMemoryCompanyClientRepository = require('./infrastructure/repositories/InMemoryCompanyClientRepository');
const PostgresCompanyClientRepository = require('./infrastructure/repositories/PostgresCompanyClientRepository');
const RegisterDirectEmployeeUseCase = require('./application/useCases/allies/RegisterDirectEmployeeUseCase');
const RegisterClientCompanyUseCase = require('./application/useCases/auth/RegisterClientCompanyUseCase');
const RegisterClientNaturalPersonUseCase = require('./application/useCases/auth/RegisterClientNaturalPersonUseCase');
const ListAllyAbsencesUseCase = require('./application/useCases/availability/ListAllyAbsencesUseCase');
const CreateAllyAbsenceUseCase = require('./application/useCases/availability/CreateAllyAbsenceUseCase');
const UpdateAllyAbsenceUseCase = require('./application/useCases/availability/UpdateAllyAbsenceUseCase');
const DeleteAllyAbsenceUseCase = require('./application/useCases/availability/DeleteAllyAbsenceUseCase');

const PgElegibilidadRepository = require('./infrastructure/repositories/PgElegibilidadRepository');
const PgSolicitudContextRepository = require('./infrastructure/repositories/PgSolicitudContextRepository');
const PgNotificacionRepository = require('./infrastructure/repositories/PgNotificacionRepository');
const ListEligibleAlliesUseCase = require('./application/useCases/dispatch/ListEligibleAlliesUseCase');
const GetSolicitudContextUseCase = require('./application/useCases/dispatch/GetSolicitudContextUseCase');
const PublishNotificationUseCase = require('./application/useCases/dispatch/PublishNotificationUseCase');
const ListNotificationsUseCase = require('./application/useCases/dispatch/ListNotificationsUseCase');
const ListMyInboxUseCase = require('./application/useCases/notifications/ListMyInboxUseCase');
const { createPushProvider } = require('./infrastructure/push/createPushProvider');
const GetOwnAllyProfileUseCase = require('./application/useCases/dispatch/GetOwnAllyProfileUseCase');
const PgServiceRequestRepository = require('./infrastructure/repositories/PgServiceRequestRepository');
const CreateServiceRequestUseCase = require('./application/useCases/requests/CreateServiceRequestUseCase');
const ConsultOwnServiceRequestsUseCase = require('./application/useCases/requests/ConsultOwnServiceRequestsUseCase');

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
    // Reglas de categoría en MANI-Java (US-03.1.1-M6). Sin RULES_SERVICE_URL
    // (solo permitido en DEV/test) crear o editar categorías responde 503: no
    // hay copia local de las reglas a la que caer.
    this.ruleEvaluationService = new RulesServiceHttpClient({ baseUrl: config.rulesServiceUrl });
    // Asignaciones del aliado en MANI-Dispatch (SCRUM-853, criterio T1). Sin DISPATCH_SERVICE_URL, la lectura
    // de reglas del sitio por un aliado responde 503; el dueño y el admin no dependen de Dispatch.
    this.dispatchAssignmentService = new DispatchServiceHttpClient({ baseUrl: config.dispatchServiceUrl });

    // Con Supabase configurado (QA/producción) se usa la persistencia e identidad
    // reales; sin configurar (DEV/test sin credenciales) cae a implementaciones
    // en memoria, igual que ya hacía el resto del container.
    if (this.supabaseClientFactory.isConfigured()) {
      this.profileRepository = new SupabaseProfileRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.tenantRepository = new SupabaseTenantRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.catalogRepository = new SupabaseCatalogRepository({ supabaseClientFactory: this.supabaseClientFactory });
      this.usuarioRepository = new SupabaseUsuarioRepository({ supabaseClientFactory: this.supabaseClientFactory });
      const supabaseAliadoRepository = new SupabaseAliadoRepository({ supabaseClientFactory: this.supabaseClientFactory });
      // Con DATABASE_URL la resolución de la verificación se escribe por pg, donde una prueba
      // contra PostgreSQL acredita que verificado_por queda en la base (CA-5, TEC-20).
      this.aliadoRepository = this.pgPoolFactory.isConfigured()
        ? new TransactionalAliadoRepository({ pgPoolFactory: this.pgPoolFactory, delegate: supabaseAliadoRepository })
        : supabaseAliadoRepository;
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
      this.legalDocumentRepository = new SupabaseLegalDocumentRepository({
        supabaseClientFactory: this.supabaseClientFactory,
      });
      this.userConsentRepository = new SupabaseUserConsentRepository({
        supabaseClientFactory: this.supabaseClientFactory,
      });
      if (this.pgPoolFactory.isConfigured()) {
        this.siteRepository = new PostgresSiteRepository({ pgPoolFactory: this.pgPoolFactory });
        this.clientRepository = new PostgresClientRepository({ pgPoolFactory: this.pgPoolFactory });
        this.companyClientRepository = new PostgresCompanyClientRepository({ pgPoolFactory: this.pgPoolFactory });
      } else {
        this.siteRepository = new InMemorySiteRepository();
        this.clientRepository = new InMemoryClientRepository();
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
      this.siteRepository = new InMemorySiteRepository();
      this.clientRepository = new InMemoryClientRepository();
      this.legalDocumentRepository = new InMemoryLegalDocumentRepository();
      this.userConsentRepository = new InMemoryUserConsentRepository();
      this.companyClientRepository = new InMemoryCompanyClientRepository();
    }

    // 2. Instancias de Aplicación (Casos de Uso) con Dependencias Inyectadas (DIP)
    this.listTenantsUseCase = new ListTenantsUseCase({
      tenantRepository: this.tenantRepository,
    });

    this.getOwnProfileUseCase = new GetOwnProfileUseCase({
      profileRepository: this.profileRepository,
    });

    this.updateOwnProfileUseCase = new UpdateOwnProfileUseCase({
      profileRepository: this.profileRepository,
      fileStorageService: this.fileStorageService,
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

    // Elegibilidad y mensajería para Dispatch (ADR-0030): consultas directas a PostgreSQL con el tenant del JWT.
    // Sin DATABASE_URL no hay respaldo en memoria: las rutas responden 503 en lugar de inventar datos.
    this.elegibilidadRepository = new PgElegibilidadRepository({ pgPoolFactory: this.pgPoolFactory });
    this.solicitudContextRepository = new PgSolicitudContextRepository({ pgPoolFactory: this.pgPoolFactory });
    this.notificacionRepository = new PgNotificacionRepository({ pgPoolFactory: this.pgPoolFactory });
    this.listEligibleAlliesUseCase = new ListEligibleAlliesUseCase({ elegibilidadRepository: this.elegibilidadRepository });
    this.getSolicitudContextUseCase = new GetSolicitudContextUseCase({
      solicitudContextRepository: this.solicitudContextRepository,
    });
    this.getOwnAllyProfileUseCase = new GetOwnAllyProfileUseCase({ aliadoRepository: this.aliadoRepository });
    // Proveedor push por ambiente (PUSH_PROVIDER, por omisión el mock de HU-M09-06): sin FCM ni APNs reales.
    this.pushProvider = createPushProvider(config.pushProvider);
    const notificationDeps = { notificacionRepository: this.notificacionRepository, pushProvider: this.pushProvider };
    this.publishNotificationUseCase = new PublishNotificationUseCase(notificationDeps);
    this.listNotificationsUseCase = new ListNotificationsUseCase({ notificacionRepository: this.notificacionRepository });
    this.listMyInboxUseCase = new ListMyInboxUseCase(notificationDeps);

    this.listCatalogCategoriesUseCase = new ListCatalogCategoriesUseCase({
      catalogRepository: this.catalogRepository,
    });

    this.listCategoriesForTenantUseCase = new ListCategoriesForTenantUseCase({
      catalogRepository: this.catalogRepository,
    });
    this.getCategoryUseCase = new GetCategoryUseCase({ catalogRepository: this.catalogRepository });
    this.createCategoryUseCase = new CreateCategoryUseCase({
      catalogRepository: this.catalogRepository,
      ruleEvaluationService: this.ruleEvaluationService,
    });
    this.updateCategoryUseCase = new UpdateCategoryUseCase({
      catalogRepository: this.catalogRepository,
      ruleEvaluationService: this.ruleEvaluationService,
    });
    this.setCategoryStatusUseCase = new SetCategoryStatusUseCase({ catalogRepository: this.catalogRepository });

    // Creación de solicitudes (SCRUM-1072): transacción sobre `pg` con withTenantContext (ADR-0032).
    // Sin DATABASE_URL no hay respaldo en memoria: responde 503.
    this.serviceRequestRepository = new PgServiceRequestRepository({ pgPoolFactory: this.pgPoolFactory });
    this.createServiceRequestUseCase = new CreateServiceRequestUseCase({
      serviceRequestRepository: this.serviceRequestRepository,
      fileStorageService: this.fileStorageService,
    });
    this.consultOwnServiceRequestsUseCase = new ConsultOwnServiceRequestsUseCase({
      serviceRequestRepository: this.serviceRequestRepository,
    });

    this.checkHealthUseCase = new CheckHealthUseCase({
      supabaseConnectionChecker: this.supabaseConnectionChecker,
      envLabel: config.envLabel,
    });

    this.configureSiteRulesUseCase = new ConfigureSiteRulesUseCase({
      siteRepository: this.siteRepository,
      clientRepository: this.clientRepository,
    });

    this.getSiteRulesForAllyUseCase = new GetSiteRulesForAllyUseCase({
      siteRepository: this.siteRepository,
      clientRepository: this.clientRepository,
      dispatchAssignmentService: this.dispatchAssignmentService,
    });

    this.validateAllyScheduleUseCase = new ValidateAllyScheduleUseCase({
      siteRepository: this.siteRepository,
    });

    this.getActiveLegalDocumentsUseCase = new GetActiveLegalDocumentsUseCase({
      legalDocumentRepository: this.legalDocumentRepository,
      tenantRepository: this.tenantRepository,
    });

    this.registerUserConsentUseCase = new RegisterUserConsentUseCase({
      legalDocumentRepository: this.legalDocumentRepository,
      userConsentRepository: this.userConsentRepository,
    });
    this.registerCompanyClientWithSitesUseCase = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: this.companyClientRepository,
      authIdentityService: this.authIdentityService,
      tenantRepository: this.tenantRepository,
    });

    this.addSiteToCompanyClientUseCase = new AddSiteToCompanyClientUseCase(this.companyClientRepository);

    this.getCompanyClientSitesUseCase = new GetCompanyClientSitesUseCase(this.companyClientRepository);

    this.updateCompanyClientSiteUseCase = new UpdateCompanyClientSiteUseCase(this.companyClientRepository);

    this.registerAllyNaturalPersonUseCase = new RegisterAllyNaturalPersonUseCase({
      tenantRepository: this.tenantRepository,
      catalogRepository: this.catalogRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      documentoKycRepository: this.documentoKycRepository,
      fileStorageService: this.fileStorageService,
      authIdentityService: this.authIdentityService,
      registerUserConsentUseCase: this.registerUserConsentUseCase,
      userConsentRepository: this.userConsentRepository,
    });

    this.registerAllyCompanyUseCase = new RegisterAllyCompanyUseCase({
      tenantRepository: this.tenantRepository,
      catalogRepository: this.catalogRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoRepository: this.aliadoRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      documentoKycRepository: this.documentoKycRepository,
      fileStorageService: this.fileStorageService,
      authIdentityService: this.authIdentityService,
    });

    this.listAlliesVerificationUseCase = new ListAlliesVerificationUseCase({
      aliadoRepository: this.aliadoRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
      documentoKycRepository: this.documentoKycRepository,
    });

    this.getAllyVerificationDetailUseCase = new GetAllyVerificationDetailUseCase({
      aliadoRepository: this.aliadoRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
      documentoKycRepository: this.documentoKycRepository,
    });

    this.getKycDocumentSignedUrlUseCase = new GetKycDocumentSignedUrlUseCase({
      aliadoRepository: this.aliadoRepository,
      documentoKycRepository: this.documentoKycRepository,
      fileStorageService: this.fileStorageService,
    });

    this.resolveAllyVerificationUseCase = new ResolveAllyVerificationUseCase({
      aliadoRepository: this.aliadoRepository,
      usuarioRepository: this.usuarioRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
      documentoKycRepository: this.documentoKycRepository,
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

    this.registerClientCompanyUseCase = new RegisterClientCompanyUseCase({
      tenantRepository: this.tenantRepository,
      usuarioRepository: this.usuarioRepository,
      clienteRepository: this.clienteRepository,
      authIdentityService: this.authIdentityService,
      registerUserConsentUseCase: this.registerUserConsentUseCase,
      userConsentRepository: this.userConsentRepository,
    });
  }
}

const container = new Container();

module.exports = container;

