const crypto = require('node:crypto');
const DirectEmployee = require('../../../domain/entities/DirectEmployee');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_DOCUMENT_TYPES = ['CC', 'CE', 'PASSPORT', 'NIT'];

async function safeRun(action) {
  try {
    await action();
  } catch (err) {
    console.error('[RegisterDirectEmployeeUseCase] Falla en compensación:', err?.message || err);
  }
}

/**
 * Caso de Uso: Registrar Empleado Directo (US-02.1.5 / SCRUM-850 / RF-05).
 * Permite al Administrador del Tenant crear cuentas para empleados directos de su empresa.
 * No requiere flujo de aprobación KYC ni documentos. El empleado queda con tipo EMPLEADO_DIRECTO
 * y estado_verificacion = 'VERIFICADO' inmediatamente.
 *
 * Crea la identidad en Supabase Auth (auth.users) para habilitar inicio de sesión
 * y sincroniza la información en las tablas public.usuario y public.aliado.
 * Implementa compensación (B3 / SAGA local) ante fallos intermedios.
 */
class RegisterDirectEmployeeUseCase {
  constructor({
    tenantRepository,
    catalogRepository,
    usuarioRepository,
    aliadoRepository,
    aliadoCategoriaRepository,
    authIdentityService,
  }) {
    this.tenantRepository = tenantRepository;
    this.catalogRepository = catalogRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.authIdentityService = authIdentityService;
  }

  _validate({ tenantId, fullName, email, password, documentType, documentNumber }) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      throw new ValidationError('El nombre o fullName es requerido y debe tener al menos 2 caracteres', 'VALIDATION_ERROR');
    }
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (password !== undefined && password !== null) {
      if (typeof password !== 'string' || password.length < 8) {
        throw new ValidationError('password debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
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
    const rawFullName = input.fullName || input.nombre;
    const rawPhone = input.phone || input.telefono;
    const rawDocType = input.documentType || input.tipoDocumento;
    const rawDocNumber = input.documentNumber || input.numeroDocumento;
    const { tenantId, email, password, categoriaId, zonaId } = input;

    this._validate({
      tenantId,
      fullName: rawFullName,
      email,
      password,
      documentType: rawDocType,
      documentNumber: rawDocNumber,
    });

    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantId}" no existe`, 'TENANT_NOT_FOUND');
    }
    if (!tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantId}" no está activo`, 'TENANT_NOT_FOUND');
    }

    if (categoriaId) {
      const categoria = await this.catalogRepository.findById(tenantId, categoriaId);
      if (!categoria || !categoria.isActive()) {
        throw new ValidationError(`La categoría "${categoriaId}" no existe o no está activa`, 'CATEGORY_NOT_FOUND');
      }
    }

    const existingByEmail = await this.usuarioRepository.findByEmail(tenantId, email);
    if (existingByEmail) {
      throw new ConflictError('Ya existe un usuario registrado con ese email en este tenant', 'EMAIL_ALREADY_REGISTERED');
    }

    if (rawDocNumber) {
      const existingByDocument = await this.aliadoRepository.findByDocumentNumber(tenantId, rawDocNumber);
      if (existingByDocument) {
        throw new ConflictError(
          'Ya existe un aliado registrado con ese número de documento',
          'DOCUMENT_ALREADY_REGISTERED'
        );
      }
    }

    const finalPassword = password || `Emp-${crypto.randomUUID().slice(0, 8)}!Aa1`;

    // 1. Identidad en auth.users
    const { userId } = await this.authIdentityService.createUser({
      tenantId,
      email,
      password: finalPassword,
      role: 'ALLY',
    });

    // 2. Persistencia en public.usuario y public.aliado con compensación (B3)
    let usuarioCreado = false;
    let aliadoCreado = false;
    let aliadoCategoriaCreada = false;
    let aliadoId;

    try {
      await this.usuarioRepository.create({
        id: userId,
        tenantId,
        email,
        rol: 'ALLY',
        estado: 'ACTIVE',
        phone: rawPhone,
      });
      usuarioCreado = true;

      const aliado = await this.aliadoRepository.create({
        tenantId,
        usuarioId: userId,
        tipo: 'EMPLEADO_DIRECTO',
        nombreRazonSocial: rawFullName.trim(),
        estadoVerificacion: 'VERIFICADO',
        documentType: rawDocType,
        documentNumber: rawDocNumber,
      });
      aliadoCreado = true;
      aliadoId = aliado?.id || userId;

      if (categoriaId && this.aliadoCategoriaRepository) {
        await this.aliadoCategoriaRepository.create({
          tenantId,
          aliadoId,
          categoriaId,
        });
        aliadoCategoriaCreada = true;
      }
    } catch (err) {
      if (aliadoCategoriaCreada && this.aliadoCategoriaRepository) {
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

    const directEmployee = new DirectEmployee({
      id: aliadoId,
      usuarioId: userId,
      tenantId,
      fullName: rawFullName.trim(),
      email,
      phone: rawPhone,
      documentType: rawDocType,
      documentNumber: rawDocNumber,
      categoriaId: categoriaId || null,
      zonaId: zonaId || null,
      status: 'VERIFIED',
      tipo: 'EMPLEADO_DIRECTO',
    });

    return {
      employee: directEmployee.toJSON(),
      temporaryPassword: finalPassword,
    };
  }
}

module.exports = RegisterDirectEmployeeUseCase;
