const Profile = require('../../../domain/entities/Profile');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

const VALID_DOCUMENT_TYPES = ['CC', 'CE', 'PASSPORT'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Migración de registrar_aliado_persona_natural + handle_new_user + el upsert a
 * usuario (ADR-0022). Antes esta lógica vivía en PL/pgSQL, disparada por
 * supabase.auth.signUp() desde el cliente Flutter; ahora Core Node la ejecuta
 * explícitamente y es el único llamador de la identidad de autenticación.
 */
class RegisterAllyNaturalPersonUseCase {
  constructor({ tenantRepository, usuarioRepository, aliadoRepository, authIdentityService }) {
    this.tenantRepository = tenantRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoRepository = aliadoRepository;
    this.authIdentityService = authIdentityService;
  }

  _validate({ tenantId, fullName, email, password, phone, documentType, documentNumber }) {
    if (!tenantId) throw new ValidationError('Encabezado X-Tenant-Id requerido', 'VALIDATION_ERROR');
    if (!fullName || typeof fullName !== 'string') {
      throw new ValidationError('fullName es requerido', 'VALIDATION_ERROR');
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (!password || password.length < 8) {
      throw new ValidationError('password es requerido y debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
    }
    if (!phone || typeof phone !== 'string') {
      throw new ValidationError('phone es requerido', 'VALIDATION_ERROR');
    }
    if (!VALID_DOCUMENT_TYPES.includes(documentType)) {
      throw new ValidationError(
        `documentType inválido. Valores permitidos: ${VALID_DOCUMENT_TYPES.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
    if (!documentNumber || typeof documentNumber !== 'string') {
      throw new ValidationError('documentNumber es requerido', 'VALIDATION_ERROR');
    }
  }

  async execute(input) {
    this._validate(input);
    const { tenantId, fullName, email, password, phone, documentType, documentNumber } = input;

    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantId}" no existe`, 'TENANT_NOT_FOUND');
    }

    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, email);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
    }

    const existingByDocument = await this.aliadoRepository.findByDocumentNumber(tenantId, documentNumber);
    if (existingByDocument) {
      throw new ConflictError(
        'Ya existe un aliado registrado con ese número de documento',
        'DOCUMENT_ALREADY_REGISTERED'
      );
    }

    const identity = await this.authIdentityService.createIdentity({
      tenantId,
      email,
      password,
      role: 'ALLY',
    });

    await this.usuarioRepository.create({
      id: identity.userId,
      tenantId,
      email,
      rol: 'ALLY',
      estado: 'ACTIVE',
      phone,
    });

    await this.aliadoRepository.create({
      tenantId,
      usuarioId: identity.userId,
      tipo: 'PERSONA_NATURAL',
      nombreRazonSocial: fullName,
      estadoVerificacion: 'PENDING',
      documentType,
      documentNumber,
    });

    const profile = new Profile({
      id: identity.userId,
      userId: identity.userId,
      role: 'ALLY',
      fullName,
      status: 'PENDING',
      tenantId,
    });

    return {
      profile: profile.toJSON(),
      tokens: {
        accessToken: identity.accessToken,
        refreshToken: identity.refreshToken,
        expiresIn: identity.expiresIn,
      },
    };
  }
}

module.exports = RegisterAllyNaturalPersonUseCase;
