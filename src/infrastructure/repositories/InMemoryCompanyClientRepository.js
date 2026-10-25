const crypto = require('crypto');
const CompanyClient = require('../../domain/entities/CompanyClient');
const Site = require('../../domain/entities/Site');
const ICompanyClientRepository = require('../../domain/ports/ICompanyClientRepository');

/**
 * Adaptador de Infraestructura en Memoria para Cliente Empresa y Sitios.
 * Utilizado para pruebas unitarias y entornos sin base de datos activa.
 */
class InMemoryCompanyClientRepository extends ICompanyClientRepository {
  constructor() {
    super();
    this.clients = new Map(); // key: id -> CompanyClient
    this.sites = new Map();   // key: id -> Site
  }

  async save(companyClient, sites, { userId } = {}) {
    const clientId = crypto.randomUUID();
    const effectiveUserId = userId || crypto.randomUUID();

    const savedClient = new CompanyClient({
      id: clientId,
      tenantId: companyClient.tenantId,
      razonSocial: companyClient.razonSocial,
      nit: companyClient.nit,
      email: companyClient.email,
      telefono: companyClient.telefono,
      nombreRepresentante: companyClient.nombreRepresentante,
      tipo: companyClient.tipo || 'PERSONA_JURIDICA',
      estado: companyClient.estado || 'ACTIVO',
      creadoEn: new Date(),
    });
    savedClient.usuarioId = effectiveUserId;
    this.clients.set(clientId, savedClient);

    const savedSites = (sites || []).map((s) => {
      const siteId = s.id || crypto.randomUUID();
      const savedSite = new Site({
        id: siteId,
        tenantId: companyClient.tenantId,
        clienteId: clientId,
        nombre: s.nombre,
        direccion: s.direccion,
        zonaId: s.zonaId,
        reglas: s.reglas,
        creadoEn: s.creadoEn || new Date(),
      });
      this.sites.set(siteId, savedSite);
      return savedSite;
    });

    return { client: savedClient, sites: savedSites };
  }

  async findById(id, tenantId) {
    const client = this.clients.get(id);
    if (client && client.tenantId === tenantId) {
      return client;
    }
    return null;
  }

  async findByUsuarioId(usuarioId, tenantId) {
    for (const client of this.clients.values()) {
      if (client.usuarioId === usuarioId && client.tenantId === tenantId) return client;
    }
    return null;
  }

  async findByNitAndTenant(nit, tenantId) {
    for (const client of this.clients.values()) {
      if (client.nit === nit && client.tenantId === tenantId) {
        return client;
      }
    }
    return null;
  }

  async findByEmailAndTenant(email, tenantId) {
    const lowerEmail = email.toLowerCase();
    for (const client of this.clients.values()) {
      if (client.email.toLowerCase() === lowerEmail && client.tenantId === tenantId) {
        return client;
      }
    }
    return null;
  }

  async addSite(clienteId, tenantId, site) {
    const siteId = site.id || crypto.randomUUID();
    const savedSite = new Site({
      id: siteId,
      tenantId,
      clienteId,
      nombre: site.nombre,
      direccion: site.direccion,
      zonaId: site.zonaId,
      contactoNombre: site.contactoNombre,
      contactoTelefono: site.contactoTelefono,
      reglas: site.reglas,
      creadoEn: new Date(),
    });
    this.sites.set(siteId, savedSite);
    return savedSite;
  }

  async findSitesByClientId(clienteId, tenantId) {
    const results = [];
    for (const site of this.sites.values()) {
      if (site.clienteId === clienteId && site.tenantId === tenantId) {
        results.push(site);
      }
    }
    return results;
  }

  async findSiteById(clienteId, siteId, tenantId) {
    const site = this.sites.get(siteId);
    if (!site || site.clienteId !== clienteId || site.tenantId !== tenantId) return null;
    return site;
  }

  async updateSite(clienteId, tenantId, site) {
    const actual = await this.findSiteById(clienteId, site.id, tenantId);
    if (!actual) return null;
    const guardada = new Site({ ...site.toJSON(), reglas: actual.reglas, creadoEn: actual.creadoEn });
    this.sites.set(site.id, guardada);
    return guardada;
  }
}

InMemoryCompanyClientRepository.InMemoryCompanyClientRepository = InMemoryCompanyClientRepository;
module.exports = InMemoryCompanyClientRepository;
