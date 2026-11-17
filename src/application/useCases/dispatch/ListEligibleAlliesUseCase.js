const {
  requireDispatchSession,
  requireUuid,
  uuidList,
  tipoOpcional,
  paginaElegibles,
  MAX_EXCLUIDOS,
} = require('./dispatchAccess');

class ListEligibleAlliesUseCase {
  constructor({ elegibilidadRepository }) {
    if (!elegibilidadRepository) throw new Error('elegibilidadRepository es requerido para ListEligibleAlliesUseCase');
    this.elegibilidadRepository = elegibilidadRepository;
  }

  async execute({ session, query = {} }) {
    const ctx = requireDispatchSession(session);

    const categoriaId = requireUuid(query.categoriaId, 'categoriaId');
    const zonaId = requireUuid(query.zonaId, 'zonaId');
    // `requestId` queda por compatibilidad con clientes anteriores: se valida, pero ya no filtra. Los rechazos
    // son del dominio de Dispatch, que los manda resueltos en `excludeAllyIds` (ADR-0030).
    if (query.requestId) requireUuid(query.requestId, 'requestId');
    const excludeAllyIds = uuidList(query.excludeAllyIds, 'excludeAllyIds', MAX_EXCLUIDOS);
    const tipo = tipoOpcional(query.tipo);
    const { page, pageSize } = paginaElegibles(query);

    return this.elegibilidadRepository.findEligible(ctx, { categoriaId, zonaId, excludeAllyIds, tipo, page, pageSize });
  }
}

module.exports = ListEligibleAlliesUseCase;
