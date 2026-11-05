const { UnauthorizedError } = require('../../../domain/errors/DomainError');

/**
 * Registro del cierre de sesión para auditoría (HU-M02-03, RF-03, RNF-04).
 *
 * Core no revoca la sesión: la revocación la hace el cliente con `supabase.auth.signOut()` (T6, el proveedor es el
 * dueño de la sesión). Aquí solo queda constancia de quién cerró sesión, en qué tenant y cuándo, con el tenant y el
 * usuario tomados del JWT verificado y nunca del cuerpo (T4). Sin datos personales: ni correo ni token.
 */
class LogoutUseCase {
  constructor({ auditLogger = (entry) => console.info(JSON.stringify(entry)), now = () => new Date() } = {}) {
    this.auditLogger = auditLogger;
    this.now = now;
  }

  execute({ session, correlationId } = {}) {
    if (!session?.userId || !session?.tenantId) {
      throw new UnauthorizedError('Sesión de usuario autenticado requerida', 'UNAUTHORIZED');
    }

    this.auditLogger({
      event: 'US-02.sesion.cierre',
      tenant_id: session.tenantId,
      usuario_id: session.userId,
      rol: session.role || null,
      fecha: this.now().toISOString(),
      correlation_id: correlationId,
    });

    return { loggedOut: true };
  }
}

module.exports = LogoutUseCase;
