const { ValidationError } = require('../errors/DomainError');

class LegalDocument {
  constructor({
    id,
    tenantId = null,
    tipo,
    version = '1.0',
    contenido = '',
    isActive = true,
    createdAt = new Date(),
  }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('LegalDocument id es requerido', 'VALIDATION_ERROR');
    }
    if (!tipo || typeof tipo !== 'string') {
      throw new ValidationError('LegalDocument tipo es requerido', 'VALIDATION_ERROR');
    }

    this.id = id;
    this.tenantId = tenantId;
    this.tipo = tipo;
    this.version = version;
    this.contenido = contenido;
    this.isActive = Boolean(isActive);
    this.createdAt = createdAt;
  }

  isDocumentActive() {
    return this.isActive;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      tipo: this.tipo,
      version: this.version,
      contenido: this.contenido,
      isActive: this.isActive,
      createdAt: this.createdAt,
    };
  }
}

module.exports = LegalDocument;
