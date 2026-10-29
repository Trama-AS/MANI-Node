const { contextoDeSesion, exigirRol, idValido, invalido } = require('./additionAccess');
const { centavos } = require('../quotes/importe');
const { entregarAviso } = require('../notifications/entregarAviso');

const MOTIVO_MIN = 10;
const MOTIVO_MAX = 500;
// Una semana de trabajo adicional como máximo: un valor mayor es casi seguro un error de unidades.
const TIEMPO_MAX_MINUTOS = 7 * 24 * 60;

function motivoDe(valor) {
  if (valor !== undefined && valor !== null && typeof valor !== 'string') throw invalido('motivo debe ser texto');
  const motivo = String(valor ?? '').trim();
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    throw invalido(`el motivo es obligatorio y debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres`);
  }
  return motivo;
}

function tiempoDe(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const minutos = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
  if (!Number.isInteger(minutos) || minutos <= 0 || minutos > TIEMPO_MAX_MINUTOS) {
    throw invalido(`tiempoAdicionalMinutos debe ser un entero entre 1 y ${TIEMPO_MAX_MINUTOS}`);
  }
  return minutos;
}

/**
 * US-04.3.5 (SCRUM-872, RF-34): con el servicio EN_EJECUCION, el aliado asignado pide una adición por un imprevisto
 * con motivo, mano de obra y materiales adicionales y, si quiere, el tiempo extra estimado. Core calcula el total de
 * la adición; el total del servicio no cambia hasta que el cliente la acepta. El cliente recibe el aviso.
 */
class RequestAdditionUseCase {
  constructor({ additionRepository, notificador = null }) {
    if (!additionRepository) throw new Error('additionRepository es requerido');
    this.additionRepository = additionRepository;
    // SCRUM-884: el cliente recibe el push de la adición. Opcional para probar sin notificaciones.
    this.notificador = notificador;
  }

  async execute({ user, solicitudId, body = {}, correlationId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['ALLY'], 'solo el aliado asignado puede pedir una adición');
    const id = idValido(solicitudId, 'solicitud');

    const motivo = motivoDe(body.motivo);
    const manoObra = centavos(body.valorManoObra, 'valorManoObra', invalido);
    const materiales = centavos(body.valorMateriales, 'valorMateriales', invalido);
    if (manoObra + materiales === 0) throw invalido('al menos uno de los valores debe ser mayor que cero');

    const { notificacionId, ...resultado } = await this.additionRepository.solicitar(ctx, {
      solicitudId: id,
      motivo,
      valorManoObra: manoObra / 100,
      valorMateriales: materiales / 100,
      tiempoAdicionalMinutos: tiempoDe(body.tiempoAdicionalMinutos),
    });
    await entregarAviso(this.notificador, ctx, notificacionId, correlationId);
    return resultado;
  }
}

module.exports = RequestAdditionUseCase;
