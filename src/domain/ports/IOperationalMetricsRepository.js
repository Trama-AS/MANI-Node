/**
 * Puerto de las métricas operativas por tenant (SCRUM-900, RF-28). Recibe el contexto verificado del JWT
 * `{ tenantId, userId, role }` (T4) y un periodo `{ desde, hasta }` con fechas inclusive.
 */
class IOperationalMetricsRepository {
  /** Conteos y sumas del periodo, solo del tenant de la sesión. */
  async agregados(_ctx, _periodo) {
    throw new Error('Método agregados() no implementado en IOperationalMetricsRepository');
  }
}

module.exports = IOperationalMetricsRepository;
