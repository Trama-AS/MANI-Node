const { ValidationError } = require('../../../domain/errors/DomainError');
const isValidEmail = require('../../../domain/validation/isValidEmail');

const ACTIVE_STATES = new Set(['ACTIVE', 'ACTIVO']);

/**
 * Solicitud de recuperación de contraseña (HU-M02-10, RF-04). Pre-autenticación: el tenant se resuelve por
 * X-Tenant-Slug (ADR-0018) y la contraseña la gestiona el proveedor de identidad; Core solo orquesta.
 *
 * No revela si el correo está registrado: con o sin cuenta (o con la cuenta inactiva, o con el envío limitado por el
 * proveedor) el resultado es el mismo y el correo solo sale cuando la cuenta existe y está activa en ese tenant.
 */
class RequestPasswordRecoveryUseCase {
  constructor({
    tenantRepository,
    usuarioRepository,
    authIdentityService,
    redirectTo,
    auditLogger = (entry) => console.info(JSON.stringify(entry)),
  }) {
    this.tenantRepository = tenantRepository;
    this.usuarioRepository = usuarioRepository;
    this.authIdentityService = authIdentityService;
    this.redirectTo = redirectTo || undefined;
    this.auditLogger = auditLogger;
  }

  async execute({ tenantSlug, email, correlationId }) {
    if (!tenantSlug) throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      throw new ValidationError('email es requerido y debe tener un formato válido', 'VALIDATION_ERROR');
    }

    const tenant = await this.tenantRepository.findBySlug(tenantSlug);
    if (!tenant || !tenant.isActive()) {
      throw new ValidationError(`El tenant "${tenantSlug}" no existe`, 'TENANT_NOT_FOUND');
    }

    const usuario = await this.usuarioRepository.findByEmail(tenant.id, cleanEmail);
    const eligible = Boolean(usuario) && ACTIVE_STATES.has(String(usuario.estado).toUpperCase());

    let limitado = false;
    if (eligible) {
      try {
        await this.authIdentityService.requestPasswordRecovery({ email: cleanEmail, redirectTo: this.redirectTo });
      } catch (err) {
        // El proveedor solo limita los envíos de cuentas que existen; responder 429 delataría qué correos están
        // registrados. Se audita y se responde igual que en los demás casos. Cualquier otro fallo sí se propaga.
        if (err?.code !== 'RATE_LIMITED') throw err;
        limitado = true;
      }
    }

    // Auditoría sin el correo (dato personal); el id solo aparece cuando la cuenta existe.
    this.auditLogger({
      event: 'US-02.recuperacion_contrasena.solicitada',
      tenant_id: tenant.id,
      usuario_id: eligible ? usuario.id : null,
      correo_enviado: eligible && !limitado,
      limitado_por_proveedor: limitado,
      correlation_id: correlationId,
    });

    return { accepted: true };
  }
}

module.exports = RequestPasswordRecoveryUseCase;
