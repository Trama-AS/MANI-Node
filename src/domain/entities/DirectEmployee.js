const { ValidationError } = require('../errors/DomainError');

/**
 * Entidad de Dominio: DirectEmployee (RF-05 / US-02.1.5 / SCRUM-850)
 * Representa a un empleado directo de la empresa del tenant.
 * A diferencia del aliado externo independiente, no pasa por el flujo de
 * aprobación KYC ni requiere documentos; queda en estado VERIFICADO de inmediato.
 */
class DirectEmployee {
  constructor({
    id,
    usuarioId,
    tenantId,
    fullName,
    email,
    phone = null,
    documentType = null,
    documentNumber = null,
    categoriaId = null,
    zonaId = null,
    status = 'VERIFIED',
    tipo = 'EMPLEADO_DIRECTO',
    createdAt = new Date(),
  }) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      throw new ValidationError('fullName es requerido y debe tener al menos 2 caracteres', 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }

    this.id = id;
    this.usuarioId = usuarioId;
    this.tenantId = tenantId;
    this.fullName = fullName.trim();
    this.email = email.trim().toLowerCase();
    this.phone = phone ? String(phone).trim() : null;
    this.documentType = documentType;
    this.documentNumber = documentNumber;
    this.categoriaId = categoriaId;
    this.zonaId = zonaId;
    this.status = status;
    this.tipo = tipo;
    this.createdAt = createdAt;
  }

  isDirectEmployee() {
    return this.tipo === 'EMPLEADO_DIRECTO';
  }

  isVerified() {
    return this.status === 'VERIFIED' || this.status === 'VERIFICADO';
  }

  toJSON() {
    return {
      id: this.id,
      usuarioId: this.usuarioId,
      tenantId: this.tenantId,
      fullName: this.fullName,
      nombre: this.fullName,
      email: this.email,
      phone: this.phone,
      telefono: this.phone,
      documentType: this.documentType,
      documentNumber: this.documentNumber,
      categoriaId: this.categoriaId,
      zonaId: this.zonaId,
      tipo: this.tipo,
      tipoAliado: this.tipo,
      estadoVerificacion: 'VERIFICADO',
      status: 'VERIFIED',
      createdAt: this.createdAt,
    };
  }
}

module.exports = DirectEmployee;
