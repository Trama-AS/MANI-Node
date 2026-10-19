const IUserConsentRepository = require('../../domain/ports/IUserConsentRepository');
const UserConsent = require('../../domain/entities/UserConsent');

class InMemoryUserConsentRepository extends IUserConsentRepository {
  constructor() {
    super();
    this.consents = [];
  }

  async create(consent) {
    const record =
      consent instanceof UserConsent
        ? consent
        : new UserConsent({
            id: consent.id || `consent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ...consent,
          });

    this.consents.push(record);
    return record;
  }

  async hasConsented(usuarioId, documentoLegalId) {
    return this.consents.some(
      (c) => c.usuarioId === usuarioId && c.documentoLegalId === documentoLegalId
    );
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    this.consents = this.consents.filter((c) => {
      const matchUser = c.usuarioId === usuarioId;
      const matchTenant = !tenantId || c.tenantId === tenantId;
      return !(matchUser && matchTenant);
    });
  }
}

module.exports = InMemoryUserConsentRepository;
