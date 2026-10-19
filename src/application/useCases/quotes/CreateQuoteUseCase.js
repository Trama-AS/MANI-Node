const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

const ESTADOS_SIN_COTIZACION = ['FINALIZADA', 'CANCELADA', 'RECHAZADA'];

function montoNoNegativo(valor, campo, { obligatorio }) {
  if (valor === undefined || valor === null || valor === '') {
    if (obligatorio) throw new ValidationError(`El valor de ${campo} es obligatorio y debe ser numérico`);
    return 0;
  }
  const numero = Number(valor);
  if (Number.isNaN(numero)) throw new ValidationError(`El valor de ${campo} debe ser numérico`);
  if (numero < 0) throw new ValidationError(`El valor de ${campo} no puede ser negativo`);
  return Math.round(numero * 100) / 100;
}

/**
 * US-04.2.1 (SCRUM-865): el aliado asignado emite una cotización con mano de obra y materiales separados.
 * - El aliado se resuelve desde el usuario del JWT (`aliado.id`, no el id del usuario).
 * - La solicitud debe estar asignada a ese aliado: la asignación la hace Dispatch (ADR-0016), no Core.
 * - El tarifario lo valida Rules Service (SAD §7.3): Core no inventa un umbral; queda PENDIENTE.
 */
class CreateQuoteUseCase {
  constructor({ cotizacionRepository, solicitudRepository, eventoServicioRepository, aliadoRepository }) {
    if (!cotizacionRepository) throw new Error('cotizacionRepository es requerido');
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!eventoServicioRepository) throw new Error('eventoServicioRepository es requerido');
    if (!aliadoRepository) throw new Error('aliadoRepository es requerido');

    this.cotizacionRepository = cotizacionRepository;
    this.solicitudRepository = solicitudRepository;
    this.eventoServicioRepository = eventoServicioRepository;
    this.aliadoRepository = aliadoRepository;
  }

  async execute({ user, solicitudId, valorManoObra, valorMateriales, valor, observacion = null }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida para emitir cotización');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo un aliado puede emitir cotizaciones');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const manoObra = montoNoNegativo(valorManoObra, 'mano de obra', { obligatorio: true });
    const materiales = montoNoNegativo(valorMateriales, 'materiales', { obligatorio: false });
    const total = Math.round((manoObra + materiales) * 100) / 100;

    if (valor !== undefined && valor !== null) {
      const totalEnviado = Number(valor);
      if (Number.isNaN(totalEnviado) || Math.abs(totalEnviado - total) > 0.01) {
        throw new ValidationError(
          `El total de la cotización (${valor}) debe coincidir con la suma de mano de obra y materiales (${total})`
        );
      }
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const aliado = await this.aliadoRepository.findByUsuarioId(user.tenantId, user.userId);
    if (!aliado) {
      throw new ForbiddenError('No existe un perfil de aliado para la cuenta en este tenant');
    }

    const solicitud = await this.solicitudRepository.findById(ctx, solicitudId);
    if (!solicitud) {
      throw new NotFoundError('Solicitud no encontrada');
    }
    if (!solicitud.aliadoId) {
      throw new ConflictError('La solicitud aún no está asignada a un aliado');
    }
    if (solicitud.aliadoId !== aliado.id) {
      throw new ForbiddenError('No tienes autorización para cotizar en una solicitud asignada a otro aliado');
    }
    if (ESTADOS_SIN_COTIZACION.includes(solicitud.estado)) {
      throw new ConflictError(`No se puede cotizar una solicitud en estado ${solicitud.estado}`);
    }

    const previas = await this.cotizacionRepository.findBySolicitudId(ctx, solicitudId);
    const version = previas.length + 1;

    const cotizacion = await this.cotizacionRepository.create(ctx, {
      solicitudId,
      aliadoId: aliado.id,
      valorManoObra: manoObra,
      valorMateriales: materiales,
      estado: 'PENDIENTE',
      version,
      observacion: observacion ? String(observacion).trim() : null,
    });

    await this.solicitudRepository.updateEstado(ctx, solicitudId, 'COTIZANDO');

    await this.eventoServicioRepository.create(ctx, {
      solicitudId,
      actorId: user.userId,
      tipoEvento: 'COTIZACION_ENVIADA',
      descripcion: `Cotización v${version}: mano de obra ${manoObra}, materiales ${materiales}, total ${total}`,
    });

    return { cotizacion, validacionTarifario: 'PENDIENTE' };
  }
}

module.exports = CreateQuoteUseCase;
