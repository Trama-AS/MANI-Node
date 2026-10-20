const { ValidationError } = require('../errors/DomainError');

const VALID_ROLES = ['CLIENT', 'ALLY', 'ADMIN'];
const VALID_STATUSES = ['VERIFIED', 'PENDING', 'REJECTED'];

class Profile {
  constructor({
    id,
    userId,
    role = 'CLIENT',
    fullName,
    status = 'VERIFIED',
    tenantId = null,
    phone = undefined,
    address = undefined,
    photoUrl = undefined,
  }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Profile id es requerido');
    }
    if (!fullName || typeof fullName !== 'string') {
      throw new ValidationError('Profile fullName es requerido');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new ValidationError(`Rol inválido: ${role}. Roles permitidos: ${VALID_ROLES.join(', ')}`);
    }
    if (!VALID_STATUSES.includes(status)) {
      throw new ValidationError(`Status inválido: ${status}`);
    }

    this.id = id;
    this.userId = userId || id;
    this.role = role;
    this.fullName = fullName;
    this.status = status;
    this.tenantId = tenantId;
    if (phone !== undefined) this.phone = phone;
    if (address !== undefined) this.address = address;
    if (photoUrl !== undefined) this.photoUrl = photoUrl;
  }

  isVerified() {
    return this.status === 'VERIFIED';
  }

  toJSON() {
    const json = {
      id: this.id,
      tenantId: this.tenantId,
      role: this.role,
      fullName: this.fullName,
      status: this.status,
    };
    if (this.phone !== undefined) json.phone = this.phone;
    if (this.address !== undefined) json.address = this.address;
    if (this.photoUrl !== undefined) json.photoUrl = this.photoUrl;
    return json;
  }
}

module.exports = Profile;


