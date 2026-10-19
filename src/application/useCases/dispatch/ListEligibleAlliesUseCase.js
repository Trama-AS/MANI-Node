const { ValidationError } = require('../../../domain/errors/DomainError');
const { requireDispatchSession, requireUuid, TIPOS_ALIADO, MAX_PAGE_SIZE } = require('./dispatchAccess');

function positiveInt(value, field, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || (max && n > max)) {
    throw new ValidationError(`MANI-DSP-400: ${field} debe ser un entero entre 1 y ${max || 'el máximo'}`, 'MANI-DSP-400');
  }
  return n;
}

class ListEligibleAlliesUseCase {
  constructor({ elegibilidadRepository }) {
    if (!elegibilidadRepository) throw new Error('elegibilidadRepository es requerido para ListEligibleAlliesUseCase');
    this.elegibilidadRepository = elegibilidadRepository;
  }

  async execute({ session, query = {} }) {
    const { tenantId } = requireDispatchSession(session);

    const categoriaId = requireUuid(query.categoriaId, 'categoriaId');
    const zonaId = requireUuid(query.zonaId, 'zonaId');
    const requestId = query.requestId ? requireUuid(query.requestId, 'requestId') : undefined;

    let tipo;
    if (query.tipo) {
      tipo = String(query.tipo).trim().toUpperCase();
      if (!TIPOS_ALIADO.includes(tipo)) {
        throw new ValidationError(
          `MANI-DSP-400: tipo debe ser uno de ${TIPOS_ALIADO.join(', ')}`,
          'MANI-DSP-400'
        );
      }
    }

    const page = positiveInt(query.page, 'page', 1);
    const pageSize = positiveInt(query.pageSize, 'pageSize', 20, MAX_PAGE_SIZE);

    return this.elegibilidadRepository.findEligible({ tenantId, categoriaId, zonaId, requestId, tipo, page, pageSize });
  }
}

module.exports = ListEligibleAlliesUseCase;
