const { contextoDeSesion, exigirRol, idValido, invalido } = require('./additionAccess');
const { entregarAviso } = require('../notifications/entregarAviso');

const COMENTARIO_MAX = 500;

// Efecto de cada decisión del cliente. Rechazar no termina el servicio: sigue EN_EJECUCION con lo pactado
// (decisión de la PO, 27-oct).
const DECISIONES = {
  ACEPTAR: { accion: 'ACEPTAR', adicion: 'ACEPTADA', evento: 'ADICION_ACEPTADA' },
  RECHAZAR: { accion: 'RECHAZAR', adicion: 'RECHAZADA', evento: 'ADICION_RECHAZADA' },
};

function comentarioDe(valor) {
  if (valor !== undefined && valor !== null && typeof valor !== 'string') throw invalido('comentario debe ser texto');
  const comentario = String(valor ?? '').trim();
  if (comentario.length > COMENTARIO_MAX) throw invalido(`el comentario admite máximo ${COMENTARIO_MAX} caracteres`);
  return comentario;
}

/**
 * US-04.3.5 (SCRUM-872, RF-34): el cliente dueño acepta o rechaza la adición pendiente. Al aceptarla, su valor se
 * suma al total vigente del servicio; Core vuelve a comprobar el tope del 50 % de la cotización aceptada. La
 * decisión, el evento en la bitácora y el aviso al aliado son atómicos.
 */
class RespondAdditionUseCase {
  constructor({ additionRepository, notificador = null }) {
    if (!additionRepository) throw new Error('additionRepository es requerido');
    this.additionRepository = additionRepository;
    // SCRUM-884: el aliado recibe el push de la decisión. Opcional para probar sin notificaciones.
    this.notificador = notificador;
  }

  async execute({ user, adicionId, accion, body = {}, correlationId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['CLIENT'], 'solo el cliente de la solicitud decide sobre la adición');
    const id = idValido(adicionId, 'adición');
    const decision = DECISIONES[accion];
    if (!decision) throw new Error(`Decisión desconocida: ${accion}`);

    const { notificacionId, ...resultado } = await this.additionRepository.responder(ctx, {
      adicionId: id,
      decision,
      comentario: comentarioDe(body.comentario),
    });
    await entregarAviso(this.notificador, ctx, notificacionId, correlationId);
    return resultado;
  }
}

RespondAdditionUseCase.DECISIONES = DECISIONES;
module.exports = RespondAdditionUseCase;
