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
const SupabaseUsuarioRepository = require('./infrastructure/repositories/SupabaseUsuarioRepository');
const SupabaseAliadoRepository = require('./infrastructure/repositories/SupabaseAliadoRepository');
const SupabaseAliadoCategoriaRepository = require('./infrastructure/repositories/SupabaseAliadoCategoriaRepository');
const SupabaseDocumentoKycRepository = require('./infrastructure/repositories/SupabaseDocumentoKycRepository');
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
const ListCatalogCategoriesUseCase = require('./application/useCases/catalog/ListCatalogCategoriesUseCase');
const CheckHealthUseCase = require('./application/useCases/health/CheckHealthUseCase');
const RegisterAllyNaturalPersonUseCase = require('./application/useCases/auth/RegisterAllyNaturalPersonUseCase');

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
      this.fileStorageService = new SupabaseFileStorageService({ supabaseClientFactory: this.supabaseClientFactory });
      this.authIdentityService = new SupabaseAuthIdentityService({
        supabaseClientFactory: this.supabaseClientFactory,
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      });
    } else {
      this.profileRepository = new InMemoryProfileRepository();
      this.tenantRepository = new InMemoryTenantRepository();
      this.catalogRepository = new InMemoryCatalogRepository();
      this.usuarioRepository = new InMemoryUsuarioRepository();
      this.aliadoRepository = new InMemoryAliadoRepository();
      this.aliadoCategoriaRepository = new InMemoryAliadoCategoriaRepository();
      this.documentoKycRepository = new InMemoryDocumentoKycRepository();
      this.fileStorageService = new InMemoryFileStorageService();
      this.authIdentityService = new InMemoryAuthIdentityService({ jwtSecret: config.supabaseJwtSecret });
    }

    // 2. Instancias de Aplicación (Casos de Uso) con Dependencias Inyectadas (DIP)
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

    this.listCatalogCategoriesUseCase = new ListCatalogCategoriesUseCase({
      catalogRepository: this.catalogRepository,
    });

    this.checkHealthUseCase = new CheckHealthUseCase({
      supabaseConnectionChecker: this.supabaseConnectionChecker,
      envLabel: config.envLabel,
    });

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
  }
}

const container = new Container();

module.exports = container;
