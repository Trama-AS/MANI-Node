const { ValidationError, UnauthorizedError } = require('../../../domain/errors/DomainError');

const MIN_PASSWORD_LENGTH = 8;
const ACTIVE_STATES = new Set(['ACTIVE', 'ACTIVO']);

const invalidToken = () =>
  new UnauthorizedError('El enlace de recuperación no es válido o ya venció', 'INVALID_RECOVERY_TOKEN');

/**
 * Contraseña nueva con el token del enlace del correo (HU-M02-10, RF-04). Pre-autenticación.
 *
 * El token identifica a la persona; el tenant del slug debe coincidir con el de esa cuenta (ADR-0018, T4), de modo
 * que un enlace de un tenant no sirve en otro. Cualquier fallo de identidad responde igual (INVALID_RECOVERY_TOKEN)
 * para no distinguir entre token vencido, cuenta de otro tenant o cuenta inactiva.
 */
class ResetPasswordUseCase {
  constructor({
    tenantRepository,
    usuarioRepository,
    authIdentityService,
    auditLogger = (entry) => console.info(JSON.stringify(entry)),
  }) {
    this.tenantRepository = tenantRepository;
    this.usuarioRepository = usuarioRepository;
    this.authIdentityService = authIdentityService;
    this.auditLogger = auditLogger;
  }

  async execute({ tenantSlug, accessToken, newPassword, correlationId }) {
    if (!tenantSlug) throw new ValidationError('Encabezado X-Tenant-Slug requerido', 'VALIDATION_ERROR');
    if (!accessToken || typeof accessToken !== 'string') {
      throw new ValidationError('accessToken es requerido', 'VALIDATION_ERROR');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(
        `newPassword es requerido y debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
        'VALIDATION_ERROR'
      );
    }

    const tenant = await this.tenantRepository.findBySlug(tenantSlug);
    if (!tenant || !tenant.isActive()) throw invalidToken();

    const { userId } = await this.authIdentityService.resolveRecoveryUser(accessToken);

    const usuario = await this.usuarioRepository.findById(tenant.id, userId);
    if (!usuario || !ACTIVE_STATES.has(String(usuario.estado).toUpperCase())) throw invalidToken();

    await this.authIdentityService.updatePassword(userId, newPassword);

    this.auditLogger({
      event: 'US-02.recuperacion_contrasena.restablecida',
      tenant_id: tenant.id,
      usuario_id: userId,
      correlation_id: correlationId,
    });

    return { reset: true };
  }
}

module.exports = ResetPasswordUseCase;
