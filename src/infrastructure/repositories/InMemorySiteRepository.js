const crypto = require('crypto');
const ISiteRepository = require('../../domain/ports/ISiteRepository');
const Site = require('../../domain/entities/Site');
const SiteRules = require('../../domain/entities/SiteRules');

class InMemorySiteRepository extends ISiteRepository {
  constructor() {
    super();
    this.sites = new Map();

    // Sede demo pre-cargada para pruebas locales
    const demoSite = new Site({
      id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23',
      tenantId: 'trama-demo',
      clienteId: 'demo-client-1',
      nombre: 'Sede Principal Calle 100',
      direccion: 'Calle 100 # 15-20, Oficina 501',
      zonaId: 'zona-bogota-norte',
      reglas: new SiteRules({
        horario: { inicio: '08:00', fin: '17:00', diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'] },
        permisosRequeridos: ['ARL_VIGENTE'],
        elementosProteccion: ['BOTAS_SEGURIDAD'],
      }),
    });
    this.sites.set(demoSite.id, demoSite);
  }

  async findById(id, tenantId) {
    const site = this.sites.get(id);
    if (site && site.tenantId === tenantId) {
      return site;
    }
    return null;
  }

  async updateRules(id, tenantId, rules) {
    const site = await this.findById(id, tenantId);
    if (!site) {
      throw new Error(`Sitio con ID "${id}" no encontrado en tenant "${tenantId}".`);
    }

    const rulesInstance = rules instanceof SiteRules ? rules : new SiteRules(rules);
    site.reglas = rulesInstance;
    this.sites.set(id, site);
    return site;
  }

  async create(site) {
    const record = site instanceof Site ? site : new Site(site);
    if (!record.id) {
      record.id = crypto.randomUUID();
    }
    this.sites.set(record.id, record);
    return record;
  }
}

module.exports = InMemorySiteRepository;
