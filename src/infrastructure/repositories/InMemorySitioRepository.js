const crypto = require('node:crypto');
const ISitioRepository = require('../../domain/ports/ISitioRepository');

class InMemorySitioRepository extends ISitioRepository {
  constructor() {
    super();
    this.sitios = [];
    // Fixture de desarrollo: una zona activa única, igual de simple que el
    // resto de catálogos en memoria (InMemoryCatalogRepository, etc.). `zona`
    // es un catálogo global (sin tenant_id), así que un único id basta.
    this.zonaActivaId = 'zona-demo-1';
  }

  async findFirstActiveZonaId() {
    return this.zonaActivaId;
  }

  async create({ tenantId, clienteId, zonaId, direccion, reglas }) {
    const sitio = { id: crypto.randomUUID(), tenantId, clienteId, zonaId, direccion, reglas };
    this.sitios.push(sitio);
    return sitio;
  }

  async deleteByClienteId(tenantId, clienteId) {
    this.sitios = this.sitios.filter((s) => !(s.tenantId === tenantId && s.clienteId === clienteId));
  }
}

module.exports = InMemorySitioRepository;
