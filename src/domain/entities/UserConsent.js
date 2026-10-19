const { ValidationError } = require('../errors/DomainError');

class UserConsent {
  constructor({
    id,
    tenantId = null,
    usuarioId,
    documentoLegalId,
    ipAddress = 'unknown',
    userAgent = 'unknown',
    createdAt = new Date(),
  }) {
    if (!usuarioId || typeof usuarioId !== 'string') {
      throw new ValidationError('usuarioId es requerido para registrar consentimiento', 'VALIDATION_ERROR');
    }
    if (!documentoLegalId || typeof documentoLegalId !== 'string') {
      throw new ValidationError('documentoLegalId es requerido para registrar consentimiento', 'VALIDATION_ERROR');
    }

    this.id = id;
    this.tenantId = tenantId;
    this.usuarioId = usuarioId;
    this.documentoLegalId = documentoLegalId;
    this.ipAddress = ipAddress;
    this.userAgent = userAgent;
    this.createdAt = createdAt;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      usuarioId: this.usuarioId,
      documentoLegalId: this.documentoLegalId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      createdAt: this.createdAt,
    };
  }
}

module.exports = UserConsent;
