const crypto = require('node:crypto');
const DirectEmployee = require('../../../domain/entities/DirectEmployee');
const { ValidationError, ConflictError, DomainError } = require('../../../domain/errors/DomainError');
const isValidEmail = require('../../../domain/validation/isValidEmail');

// Documento de identidad de una persona: el empleado directo no es una empresa, así que no hay NIT (decisión del PO, 26-oct).
const VALID_DOCUMENT_TYPES = ['CC', 'CE', 'PASSPORT'];
const PHONE_REGEX = /^\+?[0-9 ()-]{7,20}$/;
const TIPO_DOCUMENTO_KYC = 'documento_identidad';
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const FIRMAS = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

async function safeRun(action) {
  try {
    await action();
  } catch (err) {
    console.error('[RegisterDirectEmployeeUseCase] Falla en compensación:', err?.message || err);
  }
}

function nombreSeguro(value) {
  return String(value || 'documento')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_')
    .slice(-80);
}

/**
 * Caso de Uso: Registrar Empleado Directo (US-02.1.5 / SCRUM-850 / SCRUM-1376 / RF-05).
 * Decisión del PO (26-oct-2026): el Administrador del Tenant registra al empleado con nombre completo, tipo y número de
 * documento de identidad, correo, teléfono y al menos una categoría de servicio, y sube la COPIA de su documento de
 * identidad (PDF, JPG o PNG, hasta 5 MB). El empleado queda VERIFICADO de inmediato —lo registra el administrador, que
 * responde por él— y no pasa por la bandeja de verificación. La operación se audita (T10): quién, cuándo,
 * correlationId.
 *
 * El tenant y quién registra llegan del JWT (ADR-0018), nunca del cuerpo. Un número de documento ya registrado en el
 * tenant responde 409. Crea la identidad en Supabase Auth, sube la copia a Storage y escribe usuario, aliado,
 * categorías y documento por `directEmployeeRepository`; si un paso falla se compensa lo creado (B3).
 *
 * Los documentos adicionales por tenant (RNF-10) dependen de la configuración por tenant (CONS-44), que aún no existe:
 * quedan diferidos hasta que el PO lo confirme.
 */
class RegisterDirectEmployeeUseCase {
  constructor({
    tenantRepository,
    catalogRepository,
    usuarioRepository,
    aliadoRepository,
    directEmployeeRepository,
    fileStorageService,
    authIdentityService,
    auditLogger = (entry) => console.info(JSON.stringify(entry)),
    now = () => new Date(),
  }) {
    if (!directEmployeeRepository) throw new Error('directEmployeeRepository es requerido');
    if (!fileStorageService) throw new Error('fileStorageService es requerido');
    this.tenantRepository = tenantRepository;
    this.catalogRepository = catalogRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoRepository = aliadoRepository;
    this.directEmployeeRepository = directEmployeeRepository;
    this.fileStorageService = fileStorageService;
    this.authIdentityService = authIdentityService;
    this.auditLogger = auditLogger;
    this.now = now;
  }

  _validate({ tenantId, fullName, email, password, phone, documentType, documentNumber, categoriaIds }) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      throw new ValidationError('El nombre o fullName es requerido y debe tener al menos 2 caracteres', 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (password !== undefined && password !== null) {
      if (typeof password !== 'string' || password.length < 8) {
        throw new ValidationError('password debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
      }
    }
    if (!phone || typeof phone !== 'string' || !PHONE_REGEX.test(phone.trim())) {
      throw new ValidationError('phone es requerido y debe ser un teléfono válido', 'VALIDATION_ERROR');
    }
    if (!VALID_DOCUMENT_TYPES.includes(documentType)) {
      throw new ValidationError(
        `documentType es requerido. Valores permitidos: ${VALID_DOCUMENT_TYPES.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
    if (!documentNumber || typeof documentNumber !== 'string' || !documentNumber.trim()) {
      throw new ValidationError('documentNumber es requerido', 'VALIDATION_ERROR');
    }
    if (!Array.isArray(categoriaIds) || categoriaIds.length === 0 || categoriaIds.some((c) => !c || typeof c !== 'string')) {
      throw new ValidationError('Se requiere al menos una categoría de servicio (categoriaIds)', 'VALIDATION_ERROR');
    }
  }

  _validateDocument(documento) {
    if (!documento || !documento.buffer || !documento.buffer.length) {
      throw new ValidationError(
        'La copia del documento de identidad es obligatoria (campo documento_identidad)',
        'DOCUMENT_REQUIRED'
      );
    }
    const verifica = FIRMAS[documento.mimetype];
    if (!verifica) {
      throw new ValidationError('El documento debe ser PDF, JPG o PNG', 'DOCUMENT_TYPE_INVALID');
    }
    if (documento.buffer.length > MAX_DOCUMENT_BYTES) {
      throw new DomainError('El documento no puede superar 5 MB', 'DOCUMENT_TOO_LARGE', 413);
    }
    if (!verifica(documento.buffer)) {
      throw new ValidationError('El contenido del archivo no corresponde a su tipo', 'DOCUMENT_TYPE_INVALID');
    }
  }

  async execute(input) {
    const { tenantId, email, password, documento, adminUserId, correlationId } = input;
    const fullName = input.fullName;
    const phone = typeof input.phone === 'string' ? input.phone.trim() : input.phone;
    const documentType = input.documentType;
    const documentNumber = typeof input.documentNumber === 'string' ? input.documentNumber.trim() : input.documentNumber;
    const categoriaIds = Array.isArray(input.categoriaIds) ? [...new Set(input.categoriaIds)] : input.categoriaIds;

    this._validate({ tenantId, fullName, email, password, phone, documentType, documentNumber, categoriaIds });
    this._validateDocument(documento);

    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantId}" no existe`, 'TENANT_NOT_FOUND');
    }
    if (!tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantId}" no está activo`, 'TENANT_NOT_FOUND');
    }

    for (const categoriaId of categoriaIds) {
      const categoria = await this.catalogRepository.findById(tenantId, categoriaId);
      if (!categoria || !categoria.isActive()) {
        throw new ValidationError(`La categoría "${categoriaId}" no existe o no está activa`, 'CATEGORY_NOT_FOUND');
      }
    }

    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, email);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email en este tenant', 'EMAIL_ALREADY_REGISTERED');
    }

    const existingByDocument = await this.aliadoRepository.findByDocumentNumber(tenantId, documentNumber);
    if (existingByDocument) {
      throw new ConflictError('Ya existe un aliado registrado con ese número de documento', 'DOCUMENT_ALREADY_REGISTERED');
    }

    const generated = !password;
    const finalPassword = password || `${crypto.randomBytes(12).toString('base64url')}!Aa1`;

    // 1. Identidad en auth.users
    const { userId } = await this.authIdentityService.createUser({
      tenantId,
      email,
      password: finalPassword,
      role: 'ALLY',
    });

    // 2. Copia del documento en Storage y 3. filas de negocio (una transacción en QA/producción), con compensación (B3).
    const rutaStorage = `${tenantId}/${userId}/identidad/${crypto.randomUUID()}-${nombreSeguro(documento.originalname)}`;
    let subido = false;
    let resultado;
    try {
      await this.fileStorageService.upload({ path: rutaStorage, buffer: documento.buffer, contentType: documento.mimetype });
      subido = true;
      resultado = await this.directEmployeeRepository.registrar(
        { tenantId, userId: adminUserId, role: 'ADMIN' },
        {
          usuarioId: userId,
          email,
          phone,
          fullName: fullName.trim(),
          documentType,
          documentNumber,
          categoriaIds,
          documento: { tipoDocumento: TIPO_DOCUMENTO_KYC, rutaStorage },
        }
      );
    } catch (err) {
      if (subido) await safeRun(() => this.fileStorageService.delete(rutaStorage));
      await safeRun(() => this.authIdentityService.deleteUser(userId));
      throw err;
    }

    // T10 (RNF-04): quién, cuándo, la operación y el correlationId, sin PII (ni nombre, ni correo, ni documento).
    this.auditLogger({
      event: 'US-02.1.5.registrar_empleado_directo',
      tenant_id: tenantId,
      empleado_id: resultado.aliadoId,
      decision: 'REGISTRAR',
      estado_resultante: 'VERIFICADO',
      categorias: categoriaIds.length,
      realizado_por: adminUserId || null,
      fecha: this.now().toISOString(),
      correlation_id: correlationId || null,
    });

    const directEmployee = new DirectEmployee({
      id: resultado.aliadoId,
      usuarioId: userId,
      tenantId,
      fullName: fullName.trim(),
      email,
      phone,
      documentType,
      documentNumber,
      categoriaIds,
      status: 'VERIFIED',
      tipo: 'EMPLEADO_DIRECTO',
    });

    return {
      employee: {
        ...directEmployee.toJSON(),
        documento: {
          id: resultado.documentoId,
          tipoDocumento: TIPO_DOCUMENTO_KYC,
          contentType: documento.mimetype,
          sizeBytes: documento.buffer.length,
        },
      },
      ...(generated && { temporaryPassword: finalPassword }),
    };
  }
}

module.exports = RegisterDirectEmployeeUseCase;
