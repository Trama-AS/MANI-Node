/**
 * Puerto de dominio de la elegibilidad de aliados (ADR-0022, ADR-0030): Core es el dueño de la regla
 * y Dispatch la consulta por HTTP. Siempre acotado al tenant de la sesión.
 */
class IElegibilidadRepository {
  /**
   * Aliados VERIFICADOS y activos del tenant con la categoría (activa) y cobertura en la zona (o en una
   * zona ancestro), sin ausencia vigente y fuera de `excludeAllyIds` (los que Dispatch sabe que rechazaron).
   * @param {{ tenantId: string, userId?: string, role: string }} _ctx Contexto verificado de la sesión.
   * @param {{ categoriaId: string, zonaId: string, excludeAllyIds?: string[],
   *           tipo?: string, page: number, pageSize: number }} _criteria
   * @returns {Promise<{ allies: Array<{ id: string, nombreRazonSocial: string, tipo: string, estadoVerificacion: string }>, totalCount: number }>}
   */
  async findEligible(_ctx, _criteria) {
    throw new Error('Método findEligible() no implementado en IElegibilidadRepository');
  }
}

module.exports = IElegibilidadRepository;
