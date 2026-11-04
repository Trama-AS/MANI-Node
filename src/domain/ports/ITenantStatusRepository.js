/**
 * Puerto del estado de los tenants (SCRUM-901, RF-28 / RF-01). Lo usa solo el administrador de plataforma; recibe el
 * contexto verificado del JWT `{ tenantId, userId, role }` (T4), donde `tenantId` es el tenant de origen del actor.
 */
class ITenantStatusRepository {
  /** Cambia `tenant.estado` y registra el cambio con motivo y actor en la misma transacción. */
  async cambiarEstado(_ctx, _datos) {
    throw new Error('Método cambiarEstado() no implementado en ITenantStatusRepository');
  }

  /** Cambios de estado de un tenant, del más reciente al más antiguo. */
  async historial(_ctx, _datos) {
    throw new Error('Método historial() no implementado en ITenantStatusRepository');
  }
}

module.exports = ITenantStatusRepository;
