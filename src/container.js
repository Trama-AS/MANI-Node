const InMemoryTenantRepository = require('./infrastructure/repositories/InMemoryTenantRepository');
const InMemoryProfileRepository = require('./infrastructure/repositories/InMemoryProfileRepository');
const InMemoryCatalogRepository = require('./infrastructure/repositories/InMemoryCatalogRepository');
const TokenService = require('./infrastructure/security/TokenService');

const ListTenantsUseCase = require('./application/useCases/tenants/ListTenantsUseCase');
const GetOwnProfileUseCase = require('./application/useCases/profiles/GetOwnProfileUseCase');
const ListCatalogCategoriesUseCase = require('./application/useCases/catalog/ListCatalogCategoriesUseCase');

class Container {
  constructor() {
    // 1. Instancias de Infraestructura (Adaptadores Secundarios)
    this.tenantRepository = new InMemoryTenantRepository();
    this.profileRepository = new InMemoryProfileRepository();
    this.catalogRepository = new InMemoryCatalogRepository();
    this.tokenService = new TokenService();

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
  }
}

const container = new Container();

module.exports = container;

