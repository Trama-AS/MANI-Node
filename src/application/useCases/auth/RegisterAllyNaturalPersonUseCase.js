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
 * Ejecuta una limpieza de compensación (B3) sin dejar que un fallo —sea un
 * throw sincrónico o una promesa rechazada— interrumpa el resto de los pasos
 * de limpieza: el objetivo es el mejor esfuerzo posible, nunca todo o nada.
 */
async function safeRun(fn) {
  try {
    await fn();
  } catch {
    // Mejor esfuerzo: un fallo al compensar no debe ocultar el error original
    // ni impedir que se compensen los demás pasos ya creados.
  }
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

  _validate({ tenantSlug, fullName, email, password, categoriaId, documentos, documentType, documentNumber }) {
    if (!tenantSlug) throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
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
    const { tenantSlug, fullName, email, password, phone, categoriaId, documentos, documentType, documentNumber } =
      input;

    // ADR-0018: resolución del tenant a partir del slug público.
    const tenant = await this.tenantRepository.findBySlug(tenantSlug);

    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantSlug}" no existe`, 'TENANT_NOT_FOUND');
    }
    if (!tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantSlug}" no está activo`, 'TENANT_NOT_FOUND');
    }

    const tenantId = tenant.id;

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

    // 2-4. Todo lo posterior a crear la identidad debe compensarse (B3): sin una
    // transacción que abarque Auth + Postgres + Storage, un fallo a mitad de
    // camino dejaría un usuario de auth.users huérfano y, peor, filas de
    // usuario/aliado que harían fallar un reintento legítimo con 409 (email/
    // documento "ya registrado") aunque el registro nunca se completó.
    let usuarioCreado = false;
    let aliadoCreado = false;
    let aliadoCategoriaCreada = false;
    let documentoKycCreado = false;
    let aliadoId;
    const uploadedPaths = [];
    let tokens;

    try {
      // 2. Espejo de negocio — handle_new_user migrado explícitamente a Node.
      await this.usuarioRepository.create({ id: userId, tenantId, email, rol: 'ALLY', estado: 'ACTIVE', phone });
      usuarioCreado = true;

      const aliado = await this.aliadoRepository.create({
        tenantId,
        usuarioId: userId,
        tipo: 'PERSONA_NATURAL',
        nombreRazonSocial: fullName,
        estadoVerificacion: 'PENDING',
        documentType,
        documentNumber,
      });
      aliadoCreado = true;
      aliadoId = aliado.id || aliado.usuarioId || userId;

      await this.aliadoCategoriaRepository.create({ tenantId, aliadoId, categoriaId });
      aliadoCategoriaCreada = true;

      // 3. KYC: subir cada archivo a kyc-documentos/{tenantId}/{userId}/... y
      // registrar la fila en documento_kyc con la ruta resultante.
      const documentosConRuta = [];
      for (const doc of documentos) {
        const filename = `${Date.now()}-${sanitizeForPath(doc.filename || doc.tipoDocumento)}`;
        const path = `${tenantId}/${userId}/${filename}`;
        await this.fileStorageService.upload({ path, buffer: doc.buffer, contentType: doc.contentType });
        uploadedPaths.push(path);
        documentosConRuta.push({ tipoDocumento: doc.tipoDocumento, rutaStorage: path });
      }
      await this.documentoKycRepository.createMany(tenantId, aliadoId, documentosConRuta);
      documentoKycCreado = true;

      // 4. Recién ahora la fila de usuario existe: autenticar emite claims correctos.
      tokens = await this.authIdentityService.authenticate({ tenantId, email, password });
    } catch (err) {
      if (documentoKycCreado) {
        await safeRun(() => this.documentoKycRepository.deleteByAliadoId(tenantId, aliadoId));
      }
      await Promise.allSettled(uploadedPaths.map((path) => safeRun(() => this.fileStorageService.delete(path))));
      if (aliadoCategoriaCreada) {
        await safeRun(() => this.aliadoCategoriaRepository.deleteByAliadoId(tenantId, aliadoId));
      }
      if (aliadoCreado) {
        await safeRun(() => this.aliadoRepository.deleteByUsuarioId(tenantId, userId));
      }
      if (usuarioCreado) {
        await safeRun(() => this.usuarioRepository.deleteById(tenantId, userId));
      }
      await safeRun(() => this.authIdentityService.deleteUser(userId));
      throw err;
    }

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
