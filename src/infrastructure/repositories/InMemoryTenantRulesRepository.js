const ITenantRulesRepository = require('../../domain/ports/ITenantRulesRepository');
const { ConflictError } = require('../../domain/errors/DomainError');
const { REGLAS_POR_OMISION } = require('../../domain/rules/tenantRulesDefaults');

class InMemoryTenantRulesRepository extends ITenantRulesRepository {
  constructor() {
    super();
    // Map de tenantId -> Array de versiones { id, version, reglas, estado, creadoPor, actorRol, correlationId, creadaEn }
    this.records = new Map();
  }

  async getVigente({ tenantId }) {
    const list = this.records.get(tenantId) || [];
    const vig = list.find((r) => r.estado === 'VIGENTE');
    if (!vig) {
      return {
        version: 0,
        origen: 'POR_OMISION',
        reglas: JSON.parse(JSON.stringify(REGLAS_POR_OMISION)),
      };
    }
    return {
      id: vig.id,
      version: vig.version,
      origen: 'PROPIO',
      reglas: JSON.parse(JSON.stringify(vig.reglas)),
      estado: vig.estado,
      auditoria: {
        creadoPor: vig.creadoPor,
        actorRol: vig.actorRol,
        correlationId: vig.correlationId,
        creadaEn: vig.creadaEn,
      },
    };
  }

  async getHistorial({ tenantId }) {
    const list = this.records.get(tenantId) || [];
    return list
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((r) => ({
        id: r.id,
        version: r.version,
        estado: r.estado,
        reglas: JSON.parse(JSON.stringify(r.reglas)),
        auditoria: {
          creadoPor: r.creadoPor,
          actorRol: r.actorRol,
          correlationId: r.correlationId,
          creadaEn: r.creadaEn,
        },
      }));
  }

  async saveNuevaVersion({ tenantId, userId: actorId, role: actorRol }, { expectedVersion, reglas, correlationId }) {
    if (!this.records.has(tenantId)) {
      this.records.set(tenantId, []);
    }
    const list = this.records.get(tenantId);
    const vig = list.find((r) => r.estado === 'VIGENTE');
    const actualVersion = vig ? vig.version : 0;

    if (Number(expectedVersion) !== actualVersion) {
      throw new ConflictError(
        `MANI-RGL-409C: la versión esperada (${expectedVersion}) no coincide con la versión vigente (${actualVersion})`,
        'MANI-RGL-409C'
      );
    }

    if (vig) {
      vig.estado = 'HISTORICA';
    }

    const nextVersion = actualVersion + 1;
    const nuevo = {
      id: `00000000-0000-4000-8000-${String(list.length + 1).padStart(12, '0')}`,
      version: nextVersion,
      reglas: JSON.parse(JSON.stringify(reglas)),
      estado: 'VIGENTE',
      creadoPor: actorId,
      actorRol,
      correlationId,
      creadaEn: new Date().toISOString(),
    };
    list.push(nuevo);

    return {
      id: nuevo.id,
      version: nuevo.version,
      origen: 'PROPIO',
      reglas: nuevo.reglas,
      estado: nuevo.estado,
      auditoria: {
        creadoPor: nuevo.creadoPor,
        actorRol: nuevo.actorRol,
        correlationId: nuevo.correlationId,
        creadaEn: nuevo.creadaEn,
      },
    };
  }
}

module.exports = InMemoryTenantRulesRepository;
