const Profile = require('../../../domain/entities/Profile');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_DOCUMENT_TYPES = ['CC', 'CE', 'PASSPORT'];

function sanitizeForPath(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

/**
 * Migración de registrar_aliado_persona_natural + handle_new_user + el upsert a
 * usuario (ADR-0022). Antes esta lógica vivía en PL/pgSQL, disparada por
 * supabase.auth.signUp() desde el cliente Flutter; ahora Core Node la ejecuta
 * explícitamente y es el único llamador de la identidad de autenticación.
 *
 * Orden de operaciones importante: el Custom Access Token Hook de Supabase
 * (CFG-12) deriva tenant_id/rol de `public.usuario`, así que esa fila (y la de
 * `aliado`) se crean ANTES de llamar authenticate() — autenticar primero
 * devolvería una sesión con claims vacíos.
 */
class RegisterAllyNaturalPersonUseCase {
  constructor({
    tenantRepository,
    catalogRepository,
    usuarioRepository,
    aliadoRepository,
    aliadoCategoriaRepository,
    documentoKycRepository,
    fileStorageService,
    authIdentityService,
  }) {
    this.tenantRepository = tenantRepository;
    this.catalogRepository = catalogRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.documentoKycRepository = documentoKycRepository;
    this.fileStorageService = fileStorageService;
    this.authIdentityService = authIdentityService;
  }

  _validate({ tenantId, fullName, email, password, categoriaId, documentos, documentType, documentNumber }) {
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
    if (!categoriaId || typeof categoriaId !== 'string') {
      throw new ValidationError('categoriaId es requerido', 'VALIDATION_ERROR');
    }
    if (!Array.isArray(documentos) || documentos.length === 0) {
      throw new ValidationError('Se requiere al menos un documento KYC (p. ej. cédula)', 'VALIDATION_ERROR');
    }
    for (const doc of documentos) {
      if (!doc.tipoDocumento || !doc.buffer || !doc.buffer.length) {
        throw new ValidationError('Cada documento KYC requiere tipoDocumento y contenido de archivo', 'VALIDATION_ERROR');
      }
    }
    if (documentType && !VALID_DOCUMENT_TYPES.includes(documentType)) {
      throw new ValidationError(
        `documentType inválido. Valores permitidos: ${VALID_DOCUMENT_TYPES.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
    if (documentNumber && typeof documentNumber !== 'string') {
      throw new ValidationError('documentNumber debe ser una cadena', 'VALIDATION_ERROR');
    }
  }

  async execute(input) {
    this._validate(input);
    const { tenantId, fullName, email, password, phone, categoriaId, documentos, documentType, documentNumber } =
      input;

    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantId}" no existe`, 'TENANT_NOT_FOUND');
    }

    const categoria = await this.catalogRepository.findById(tenantId, categoriaId);
    if (!categoria || !categoria.isActive()) {
      throw new ValidationError(`La categoría "${categoriaId}" no existe o no está activa`, 'CATEGORY_NOT_FOUND');
    }

    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, email);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
    }

    if (documentNumber) {
      const existingByDocument = await this.aliadoRepository.findByDocumentNumber(tenantId, documentNumber);
      if (existingByDocument) {
        throw new ConflictError(
          'Ya existe un aliado registrado con ese número de documento',
          'DOCUMENT_ALREADY_REGISTERED'
        );
      }
    }

    // 1. Identidad en auth.users (sin iniciar sesión todavía).
    const { userId } = await this.authIdentityService.createUser({ tenantId, email, password, role: 'ALLY' });

    // 2. Espejo de negocio — handle_new_user migrado explícitamente a Node.
    await this.usuarioRepository.create({ id: userId, tenantId, email, rol: 'ALLY', estado: 'ACTIVE', phone });

    const aliado = await this.aliadoRepository.create({
      tenantId,
      usuarioId: userId,
      tipo: 'PERSONA_NATURAL',
      nombreRazonSocial: fullName,
      estadoVerificacion: 'PENDING',
      documentType,
      documentNumber,
    });
    const aliadoId = aliado.id || aliado.usuarioId || userId;

    await this.aliadoCategoriaRepository.create({ tenantId, aliadoId, categoriaId });

    // 3. KYC: subir cada archivo a kyc-documentos/{tenantId}/{userId}/... y
    // registrar la fila en documento_kyc con la ruta resultante.
    const documentosConRuta = [];
    for (const doc of documentos) {
      const filename = `${Date.now()}-${sanitizeForPath(doc.filename || doc.tipoDocumento)}`;
      const path = `${tenantId}/${userId}/${filename}`;
      await this.fileStorageService.upload({ path, buffer: doc.buffer, contentType: doc.contentType });
      documentosConRuta.push({ tipoDocumento: doc.tipoDocumento, rutaStorage: path });
    }
    await this.documentoKycRepository.createMany(tenantId, aliadoId, documentosConRuta);

    // 4. Recién ahora la fila de usuario existe: autenticar emite claims correctos.
    const tokens = await this.authIdentityService.authenticate({ tenantId, email, password });

    const profile = new Profile({
      id: userId,
      userId,
      role: 'ALLY',
      fullName,
      status: 'PENDING',
      tenantId,
    });

    return { profile: profile.toJSON(), tokens };
  }
}

module.exports = RegisterAllyNaturalPersonUseCase;
