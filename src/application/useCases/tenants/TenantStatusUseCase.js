const { dominio } = require('../sesionDeDominio');

const { invalido, sesion, uuid, texto } = dominio('MANI-TEN');

// Vocabulario del listado GET /tenants (Tenant.status) y su valor en tenant.estado (migración 0031).
const ESTADO_A_BD = { ACTIVE: 'ACTIVO', SUSPENDED: 'SUSPENDIDO', INACTIVE: 'INACTIVO' };

/**
 * Estado de los tenants (SCRUM-901 / HU-M12-07, RF-28 / RF-01). Solo el administrador de plataforma (permiso
 * PLATFORM_ADMIN, claim admin_plataforma) habilita, suspende o inactiva un tenant, siempre con motivo; cada cambio
 * queda en un registro inmutable con actor y correlación. Ningún rol de tenant, ni admin_tenant, lo puede hacer (C2).
 */
class TenantStatusUseCase {
  constructor({ tenantStatusRepository }) {
    if (!tenantStatusRepository) throw new Error('tenantStatusRepository es requerido para TenantStatusUseCase');
    this.tenantStatusRepository = tenantStatusRepository;
  }

  async cambiarEstado({ user, tenantId, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['PLATFORM_ADMIN'], 'solo el administrador de plataforma cambia el estado de un tenant');
    const id = uuid(tenantId, 'el id del tenant');
    const estado = ESTADO_A_BD[body.estado];
    if (!estado) throw invalido(`estado debe ser uno de ${Object.keys(ESTADO_A_BD).join(', ')}`);
    const motivo = texto(body.motivo, 'motivo', { min: 10, max: 500, obligatorio: true });
    return this.tenantStatusRepository.cambiarEstado(ctx, { tenantId: id, estado, motivo, correlationId });
  }

  async historial({ user, tenantId }) {
    const ctx = sesion(user, ['PLATFORM_ADMIN'], 'solo el administrador de plataforma consulta el historial de un tenant');
    return this.tenantStatusRepository.historial(ctx, { tenantId: uuid(tenantId, 'el id del tenant') });
  }
}

module.exports = TenantStatusUseCase;
module.exports.ESTADO_A_BD = ESTADO_A_BD;
