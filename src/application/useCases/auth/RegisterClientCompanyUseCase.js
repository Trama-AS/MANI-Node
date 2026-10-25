const Profile = require('../../../domain/entities/Profile');
const { ValidationError, ConflictError } = require('../../../domain/errors/DomainError');
const isValidEmail = require('../../../domain/validation/isValidEmail');

// NIT colombiano: 9 o 10 dígitos de número, con dígito de verificación opcional tras guion.
// Se aceptan puntos y espacios al escribirlo ("900.123.456-7") y se guarda sin ellos.
const NIT_RE = /^\d{9,10}(-\d)?$/;

/** Compensación de mejor esfuerzo (B3), igual que en los demás registros. */
async function safeRun(fn) {
  try {
    await fn();
  } catch {
    // Un fallo al compensar no debe ocultar el error original ni impedir los demás pasos.
  }
}

function normalizeNit(nit) {
  return typeof nit === 'string' ? nit.replace(/[.\s]/g, '').trim() : nit;
}

/**
 * Registro de cliente empresa (HU-M02-07, CONS-05, RF-08): alta de la cuenta con NIT y representante legal,
 * separada de la administración de sitios (M-03). Es pre-autenticación, como el de persona natural: el tenant
 * se resuelve por X-Tenant-Slug (ADR-0018) y la cuenta queda ACTIVA, porque un cliente no pasa por KYC.
 *
 * `POST /clients/company` (SCRUM-852) sigue siendo la operación autenticada que da de alta la empresa junto
 * con sus sedes; este caso de uso no crea sitios.
 *
 * Mismo orden que los demás registros: la fila de `usuario` debe existir antes de authenticate(), porque el
 * Custom Access Token Hook (CFG-12) deriva tenant y rol de ella.
 */
class RegisterClientCompanyUseCase {
  constructor({
    tenantRepository,
    usuarioRepository,
    clienteRepository,
    authIdentityService,
    registerUserConsentUseCase,
    userConsentRepository,
  }) {
    this.tenantRepository = tenantRepository;
    this.usuarioRepository = usuarioRepository;
    this.clienteRepository = clienteRepository;
    this.authIdentityService = authIdentityService;
    this.registerUserConsentUseCase = registerUserConsentUseCase;
    this.userConsentRepository = userConsentRepository;
  }

  _validate({ tenantSlug, razonSocial, nit, nombreRepresentante, email, password, acceptsTerms }) {
    if (!tenantSlug) throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
    if (acceptsTerms !== true && acceptsTerms !== 'true') {
      throw new ValidationError('Debe aceptar los términos y condiciones explícitamente', 'TERMS_NOT_ACCEPTED');
    }
    if (!razonSocial || typeof razonSocial !== 'string' || !razonSocial.trim()) {
      throw new ValidationError('razonSocial es requerido', 'VALIDATION_ERROR');
    }
    if (!nit || typeof nit !== 'string' || !NIT_RE.test(nit)) {
      throw new ValidationError('nit es requerido: 9 o 10 dígitos, con dígito de verificación opcional (900123456-7)', 'VALIDATION_ERROR');
    }
    if (!nombreRepresentante || typeof nombreRepresentante !== 'string' || !nombreRepresentante.trim()) {
      throw new ValidationError('nombreRepresentante es requerido', 'VALIDATION_ERROR');
    }
    if (!email || !isValidEmail(email)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }
    if (!password || password.length < 8) {
      throw new ValidationError('password es requerido y debe tener al menos 8 caracteres', 'VALIDATION_ERROR');
    }
  }

  async execute(input) {
    const normalized = { ...input, nit: normalizeNit(input.nit) };
    this._validate(normalized);
    const { tenantSlug, email, password, phone, ipAddress, userAgent } = normalized;
    const razonSocial = normalized.razonSocial.trim();
    const nombreRepresentante = normalized.nombreRepresentante.trim();
    const nit = normalized.nit;

    const tenant = await this.tenantRepository.findBySlug(tenantSlug);
    if (!tenant) {
      throw new ValidationError(`El tenant "${tenantSlug}" no existe`, 'TENANT_NOT_FOUND');
    }
    if (!tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantSlug}" no está activo`, 'TENANT_NOT_FOUND');
    }
    const tenantId = tenant.id;

    // Duplicados antes de crear la identidad: un 409 no deja cuenta en Auth.
    if (await this.usuarioRepository.findByEmail(tenantId, email)) {
      throw new ConflictError('Ya existe un usuario registrado con ese email', 'EMAIL_ALREADY_REGISTERED');
    }
    if (await this.clienteRepository.findByNit(tenantId, nit)) {
      throw new ConflictError('La empresa ya está registrada con ese NIT en este tenant', 'COMPANY_ALREADY_REGISTERED');
    }

    const { userId } = await this.authIdentityService.createUser({ tenantId, email, password, role: 'CLIENT' });

    let usuarioCreado = false;
    let clienteCreado = false;
    let consentimientoCreado = false;
    let cliente;
    let tokens;

    try {
      await this.usuarioRepository.create({ id: userId, tenantId, email, rol: 'CLIENT', estado: 'ACTIVE', phone });
      usuarioCreado = true;

      cliente = await this.clienteRepository.create({
        tenantId,
        usuarioId: userId,
        tipo: 'PERSONA_JURIDICA',
        razonSocial,
        nit,
        telefono: phone || null,
        nombreRepresentante,
      });
      clienteCreado = true;

      if (this.registerUserConsentUseCase) {
        await this.registerUserConsentUseCase.execute({
          tenantId,
          usuarioId: userId,
          ipAddress: ipAddress || 'unknown',
          userAgent: userAgent || 'unknown',
        });
        consentimientoCreado = true;
      }

      tokens = await this.authIdentityService.authenticate({ tenantId, email, password });
    } catch (err) {
      if (consentimientoCreado && this.userConsentRepository) {
        await safeRun(() => this.userConsentRepository.deleteByUsuarioId(tenantId, userId));
      }
      if (clienteCreado) {
        await safeRun(() => this.clienteRepository.deleteByUsuarioId(tenantId, userId));
      }
      if (usuarioCreado) {
        await safeRun(() => this.usuarioRepository.deleteById(tenantId, userId));
      }
      await safeRun(() => this.authIdentityService.deleteUser(userId));
      throw err;
    }

    const profile = new Profile({ id: userId, userId, role: 'CLIENT', fullName: razonSocial, status: 'VERIFIED', tenantId });
    return {
      profile: profile.toJSON(),
      company: { clienteId: cliente.id, tipo: 'PERSONA_JURIDICA', razonSocial, nit, nombreRepresentante },
      tokens,
    };
  }
}

module.exports = RegisterClientCompanyUseCase;
module.exports.normalizeNit = normalizeNit;
