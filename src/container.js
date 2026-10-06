const InMemoryTenantRepository = require('./infrastructure/repositories/InMemoryTenantRepository');
const InMemoryProfileRepository = require('./infrastructure/repositories/InMemoryProfileRepository');
const InMemoryCatalogRepository = require('./infrastructure/repositories/InMemoryCatalogRepository');
const TokenService = require('./infrastructure/security/TokenService');
const SupabaseClientFactory = require('./infrastructure/db/SupabaseClientFactory');
const SupabaseConnectionChecker = require('./infrastructure/db/SupabaseConnectionChecker');

const ListTenantsUseCase = require('./application/useCases/tenants/ListTenantsUseCase');
const GetOwnProfileUseCase = require('./application/useCases/profiles/GetOwnProfileUseCase');
const ListCatalogCategoriesUseCase = require('./application/useCases/catalog/ListCatalogCategoriesUseCase');
const CheckHealthUseCase = require('./application/useCases/health/CheckHealthUseCase');

const config = require('./config');

class Container {
  constructor() {
    // 1. Instancias de Infraestructura (Adaptadores Secundarios)
    this.tenantRepository = new InMemoryTenantRepository();
    this.profileRepository = new InMemoryProfileRepository();
    this.catalogRepository = new InMemoryCatalogRepository();
    this.tokenService = new TokenService();

    this.supabaseClientFactory = new SupabaseClientFactory({
      supabaseUrl: config.supabaseUrl,
      supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    });
    this.supabaseConnectionChecker = new SupabaseConnectionChecker({
      supabaseClientFactory: this.supabaseClientFactory,
    });

    // 2. Instancias de Aplicación (Casos de Uso) con Dependencias Inyectadas (DIP)
    this.listTenantsUseCase = new ListTenantsUseCase({
      tenantRepository: this.tenantRepository,
    });

    this.getOwnProfileUseCase = new GetOwnProfileUseCase({
      profileRepository: this.profileRepository,
    });

    this.listCatalogCategoriesUseCase = new ListCatalogCategoriesUseCase({
      catalogRepository: this.catalogRepository,
    });

    this.checkHealthUseCase = new CheckHealthUseCase({
      supabaseConnectionChecker: this.supabaseConnectionChecker,
      envLabel: config.envLabel,
    });
  }
}

const container = new Container();

module.exports = container;

