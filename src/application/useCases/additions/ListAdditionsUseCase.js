const { contextoDeSesion, exigirRol, idValido } = require('./additionAccess');

/**
 * US-04.3.5 (SCRUM-872): el cliente dueño y el aliado asignado ven las adiciones del servicio y el total vigente
 * (cotización aceptada + adiciones aceptadas), que es el que cobra el pago (SCRUM-1432).
 */
class ListAdditionsUseCase {
  constructor({ additionRepository }) {
    if (!additionRepository) throw new Error('additionRepository es requerido');
    this.additionRepository = additionRepository;
  }

  async execute({ user, solicitudId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['CLIENT', 'ALLY'], 'solo el cliente de la solicitud o su aliado asignado ven las adiciones');
    return this.additionRepository.listarPorSolicitud(ctx, idValido(solicitudId, 'solicitud'));
  }
}

module.exports = ListAdditionsUseCase;
