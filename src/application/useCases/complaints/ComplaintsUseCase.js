const { dominio } = require('../sesionDeDominio');

const { invalido, sesion, uuid, texto } = dominio('MANI-QJA');

const MOTIVOS = [
  'CALIDAD_DEL_SERVICIO',
  'INCUMPLIMIENTO_DE_HORARIO',
  'COBRO_INDEBIDO',
  'TRATO_INADECUADO',
  'DANO_A_LA_PROPIEDAD',
  'OTRO',
];
const ESTADOS = ['ABIERTA', 'EN_REVISION', 'RESUELTA', 'RECHAZADA'];
// C2 de SCRUM-896. La base aplica la misma tabla (disparador de la migración 0030).
const TRANSICIONES = {
  ABIERTA: ['EN_REVISION', 'RESUELTA', 'RECHAZADA'],
  EN_REVISION: ['RESUELTA', 'RECHAZADA'],
  RESUELTA: [],
  RECHAZADA: [],
};
const FINALES = ['RESUELTA', 'RECHAZADA'];
const LIMITE_MAXIMO = 100;

function limite(valor) {
  if (valor === undefined) return 50;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO) throw invalido(`limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}`);
  return n;
}

/**
 * Quejas (M-12, RF-26).
 *   * SCRUM-895: el cliente presenta una queja sobre un servicio propio, con motivo y descripción, y consulta las suyas.
 *   * SCRUM-896: el administrador del tenant lista las quejas del tenant y cambia su estado; cada transición queda
 *     auditada con actor, rol, fecha y nota. Cerrar una queja (RESUELTA o RECHAZADA) exige la respuesta al cliente.
 */
class ComplaintsUseCase {
  constructor({ complaintRepository }) {
    if (!complaintRepository) throw new Error('complaintRepository es requerido para ComplaintsUseCase');
    this.complaintRepository = complaintRepository;
  }

  async registrar({ user, solicitudId, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['CLIENT'], 'solo el cliente presenta quejas sobre sus servicios');
    const id = uuid(solicitudId, 'el id de la solicitud');
    if (!MOTIVOS.includes(body.motivo)) throw invalido(`motivo debe ser uno de ${MOTIVOS.join(', ')}`);
    const descripcion = texto(body.descripcion, 'descripcion', { min: 10, max: 1000, obligatorio: true });
    return this.complaintRepository.registrar(ctx, { solicitudId: id, motivo: body.motivo, descripcion, correlationId });
  }

  async mias({ user }) {
    const ctx = sesion(user, ['CLIENT'], 'solo el cliente consulta sus quejas');
    return this.complaintRepository.listar(ctx, { estado: null, limite: LIMITE_MAXIMO });
  }

  async listar({ user, query = {} }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant gestiona las quejas');
    if (query.estado !== undefined && !ESTADOS.includes(query.estado)) {
      throw invalido(`estado debe ser uno de ${ESTADOS.join(', ')}`);
    }
    return this.complaintRepository.listar(ctx, { estado: query.estado || null, limite: limite(query.limite) });
  }

  async detalle({ user, quejaId }) {
    const ctx = sesion(user, ['CLIENT', 'ADMIN'], 'tu rol no consulta quejas');
    return this.complaintRepository.detalle(ctx, { quejaId: uuid(quejaId, 'el id de la queja') });
  }

  async cambiarEstado({ user, quejaId, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant gestiona las quejas');
    const id = uuid(quejaId, 'el id de la queja');
    if (!ESTADOS.includes(body.estado)) throw invalido(`estado debe ser uno de ${ESTADOS.join(', ')}`);
    const nota = texto(body.nota, 'nota', { min: 5, max: 1000, obligatorio: FINALES.includes(body.estado) });
    return this.complaintRepository.cambiarEstado(ctx, {
      quejaId: id,
      estado: body.estado,
      nota,
      transicionesValidas: TRANSICIONES,
      correlationId,
    });
  }
}

module.exports = ComplaintsUseCase;
module.exports.MOTIVOS = MOTIVOS;
module.exports.TRANSICIONES = TRANSICIONES;
