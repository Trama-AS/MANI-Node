const Profile = require('../../../domain/entities/Profile');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeForPath(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

async function safeRun(fn) {
  try {
    await fn();
  } catch {
    // Mejor esfuerzo: un fallo al compensar no debe ocultar el error original
    // ni impedir que se compensen los demás pasos ya creados.
  }
}

/**
 * US-02.1.2-M2 (SCRUM-1063): Migración del registro de aliado empresa a Core Node
 * con la lógica del registro en el propio servicio (ADR-0022), recibiendo los datos
 * de la empresa, el representante legal y los documentos KYC por el Gateway.
 */
class RegisterAllyCompanyUseCase {
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

  _validate({ tenantSlug, razonSocial, nit, nombreRepresentante, email, password, documentos }) {
    if (!tenantSlug) {
      throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
    }
    if (!razonSocial || typeof razonSocial !== 'string' || !razonSocial.trim()) {
      throw new ValidationError('razonSocial es requerido', 'VALIDATION_ERROR');
    }
    if (!nit || typeof nit !== 'string' || !nit.trim()) {
      throw new ValidationError('nit es requerido', 'VALIDATION_ERROR');
    }
    if (!nombreRepresentante || typeof nombreRepresentante !== 'string' || !nombreRepresentante.trim()) {
      throw new ValidationError('nombreRepresentante es requerido', 'VALIDATION_ERROR');
    }
    if (!email || !EMAIL_REGEX.test(email.trim())) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (!password || password.length < 8) {
      throw new ValidationError('password es requerido y debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
    }
    if (!Array.isArray(documentos) || documentos.length === 0) {
      throw new ValidationError('Falta camara_comercio: se requiere al menos el documento de Cámara de Comercio', 'VALIDATION_ERROR');
    }
    for (const doc of documentos) {
      if (!doc.tipoDocumento || !doc.buffer || !doc.buffer.length) {
        throw new ValidationError('Cada documento KYC requiere tipoDocumento y contenido de archivo', 'VALIDATION_ERROR');
      }
    }
    const tieneCamara = documentos.some((d) => d.tipoDocumento.toUpperCase() === 'CAMARA_COMERCIO');
    if (!tieneCamara) {
      throw new ValidationError('Falta camara_comercio en los documentos adjuntos', 'VALIDATION_ERROR');
    }
  }

  async execute(input) {
    const normalized = {
      tenantSlug: input.tenantSlug,
      razonSocial: input.razonSocial ?? input.razon_social,
      nit: input.nit,
      nombreRepresentante: input.nombreRepresentante ?? input.nombre_representante,
      docRepresentante: input.docRepresentante ?? input.doc_representante,
      phone: input.phone ?? input.telefonoContacto ?? input.telefono_contacto,
      categoriaId: input.categoriaId ?? input.categoria_id,
      email: input.email,
      password: input.password,
      documentos: input.documentos,
    };

    this._validate(normalized);

    const {
      tenantSlug,
      razonSocial,
      nit,
      nombreRepresentante,
      docRepresentante,
      phone,
      categoriaId,
      email,
      password,
      documentos,
    } = normalized;

    const cleanEmail = email.trim();
    const cleanNit = nit.trim();
    const cleanRazonSocial = razonSocial.trim();

    // ADR-0018: resolución del tenant a partir del slug público.
    const tenant = await this.tenantRepository.findBySlug(tenantSlug);
    if (!tenant || !tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantSlug}" no existe o no está activo`, 'TENANT_NOT_FOUND');
    }

    const tenantId = tenant.id;

    if (categoriaId) {
      const categoria = await this.catalogRepository.findById(tenantId, categoriaId);
      if (!categoria || !categoria.isActive()) {
        throw new ValidationError(`La categoría "${categoriaId}" no existe o no está activa`, 'CATEGORY_NOT_FOUND');
      }
    }

    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, cleanEmail);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
    }

    const existingByNit = await this.aliadoRepository.findByDocumentNumber(tenantId, cleanNit);
    if (existingByNit) {
      throw new ConflictError('La empresa ya está registrada con ese NIT en este tenant', 'COMPANY_ALREADY_REGISTERED');
    }

    const { userId } = await this.authIdentityService.createUser({
      tenantId,
      email: cleanEmail,
      password,
      role: 'ALLY',
    });

    let usuarioCreado = false;
    let aliadoCreado = false;
    let aliadoCategoriaCreada = false;
    let documentoKycCreado = false;
    let aliadoId;
    const uploadedPaths = [];
    let tokens;

    try {
      await this.usuarioRepository.create({
        id: userId,
        tenantId,
        email: cleanEmail,
        rol: 'ALLY',
        estado: 'ACTIVE',
        phone: phone ? String(phone).trim() : undefined,
      });
      usuarioCreado = true;

      const aliado = await this.aliadoRepository.create({
        tenantId,
        usuarioId: userId,
        tipo: 'PERSONA_JURIDICA',
        nombreRazonSocial: cleanRazonSocial,
        estadoVerificacion: 'PENDING',
        documentType: 'NIT',
        documentNumber: cleanNit,
        nombreRepresentante: nombreRepresentante.trim(),
        docRepresentante: docRepresentante ? String(docRepresentante).trim() : undefined,
      });
      aliadoCreado = true;
      aliadoId = aliado.id || aliado.usuarioId || userId;

      if (categoriaId) {
        await this.aliadoCategoriaRepository.create({ tenantId, aliadoId, categoriaId });
        aliadoCategoriaCreada = true;
      }

      // CA-2: almacenar documentos en el bucket privado con ruta tenant_id/aliado_id/documento
      const documentosConRuta = [];
      for (const doc of documentos) {
        const filename = `${Date.now()}-${sanitizeForPath(doc.filename || doc.tipoDocumento)}`;
        const path = `${tenantId}/${aliadoId}/${filename}`;
        await this.fileStorageService.upload({ path, buffer: doc.buffer, contentType: doc.contentType });
        uploadedPaths.push(path);
        documentosConRuta.push({ tipoDocumento: doc.tipoDocumento.toUpperCase(), rutaStorage: path });
      }
      await this.documentoKycRepository.createMany(tenantId, aliadoId, documentosConRuta);
      documentoKycCreado = true;

      tokens = await this.authIdentityService.authenticate({ tenantId, email: cleanEmail, password });
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
      fullName: cleanRazonSocial,
      status: 'PENDING',
      tenantId,
    });

    return {
      usuario_id: userId,
      aliado_id: aliadoId,
      estado_verificacion: 'PENDIENTE',
      profile: profile.toJSON(),
      tokens,
    };
  }
}

module.exports = RegisterAllyCompanyUseCase;
