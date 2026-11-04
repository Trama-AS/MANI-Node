/**
 * Puerto de persistencia de las reglas operativas de tenant (SCRUM-1366 / HU-M01-03). Todo método recibe el contexto
 * verificado del JWT `{ tenantId, userId, role }` (T4).
 */
class ITenantRulesRepository {
  /** Versión VIGENTE del tenant, o la configuración por omisión con `version: 0` y `origen: 'POR_OMISION'`. */
  async getVigente(_ctx) {
    throw new Error('ITenantRulesRepository#getVigente debe implementarse');
  }

  /** Todas las versiones del tenant, de la más reciente a la más antigua. */
  async getHistorial(_ctx) {
    throw new Error('ITenantRulesRepository#getHistorial debe implementarse');
  }

  /** Archiva la vigente y guarda la siguiente si `expectedVersion` es la vigente; si no, 409 `MANI-RGL-409C`. */
  async saveNuevaVersion(_ctx, _datos) {
    throw new Error('ITenantRulesRepository#saveNuevaVersion debe implementarse');
  }
}

module.exports = ITenantRulesRepository;
