const { contextoDeSesion, exigirRol, solicitudIdValido } = require('./quoteAccess');

/**
 * US-04.2.1 (SCRUM-865), C1 y C3: el cliente dueño y el aliado asignado consultan las cotizaciones de la
 * solicitud. Para cualquier otro usuario del tenant la solicitud responde 404.
 */
class ListQuotesUseCase {
  constructor({ quoteRepository }) {
    if (!quoteRepository) throw new Error('quoteRepository es requerido');
    this.quoteRepository = quoteRepository;
  }

  async execute({ user, solicitudId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['CLIENT', 'ALLY'], 'solo el cliente dueño o el aliado asignado consultan la cotización');
    return this.quoteRepository.listarPorSolicitud(ctx, solicitudIdValido(solicitudId));
  }
}

module.exports = ListQuotesUseCase;
