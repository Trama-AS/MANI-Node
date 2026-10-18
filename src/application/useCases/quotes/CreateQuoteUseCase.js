const Cotizacion = require('../../../domain/entities/Cotizacion');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

class CreateQuoteUseCase {
  constructor({
    cotizacionRepository,
    solicitudRepository,
    historialSolicitudRepository,
    rulesServiceClient = null,
  }) {
    if (!cotizacionRepository) throw new Error('cotizacionRepository es requerido');
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!historialSolicitudRepository) throw new Error('historialSolicitudRepository es requerido');

    this.cotizacionRepository = cotizacionRepository;
    this.solicitudRepository = solicitudRepository;
    this.historialSolicitudRepository = historialSolicitudRepository;
    this.rulesServiceClient = rulesServiceClient;
  }

  async execute({
    user,
    solicitudId,
    valorManoObra,
    valorMateriales = 0,
    valor,
    moneda = 'COP',
    observacion = null,
  }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida para emitir cotización');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo un aliado puede emitir cotizaciones');
    }

    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const numManoObra = Number(valorManoObra);
    if (valorManoObra === undefined || valorManoObra === null || isNaN(numManoObra)) {
      throw new ValidationError('El valor de mano de obra es obligatorio y debe ser numérico');
    }
    if (numManoObra < 0) {
      throw new ValidationError('El valor de mano de obra no puede ser negativo');
    }

    const numMateriales = Number(valorMateriales ?? 0);
    if (isNaN(numMateriales)) {
      throw new ValidationError('El valor de materiales debe ser numérico');
    }
    if (numMateriales < 0) {
      throw new ValidationError('El valor de materiales no puede ser negativo');
    }

    // Redondeo exacto a 2 decimales según NUMERIC(14,2)
    const manoObraRedondeada = Math.round(numManoObra * 100) / 100;
    const materialesRedondeados = Math.round(numMateriales * 100) / 100;
    const totalCalculado = Math.round((manoObraRedondeada + materialesRedondeados) * 100) / 100;

    if (valor !== undefined && valor !== null) {
      const numTotalEnviado = Number(valor);
      if (isNaN(numTotalEnviado) || Math.abs(numTotalEnviado - totalCalculado) > 0.01) {
        throw new ValidationError(
          `El total de la cotización (${numTotalEnviado}) debe coincidir exactamente con la suma de mano de obra y materiales (${totalCalculado})`
        );
      }
    }

    const solicitud = await this.solicitudRepository.findById(solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    // Permisos y asignación: si la solicitud ya está asignada a otro aliado
    if (solicitud.aliadoId && solicitud.aliadoId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para cotizar en una solicitud asignada a otro aliado');
    }

    // Validación de estado de la solicitud
    const estadosInvalidos = ['FINALIZADA', 'CANCELADA', 'RECHAZADA'];
    if (estadosInvalidos.includes(solicitud.estado)) {
      throw new ConflictError(`No se puede cotizar una solicitud en estado ${solicitud.estado}`);
    }

    // Validación contra el tarifario de referencia (RF-16 / SECUENCIAS):
    // El Rules Service o tarifario define rangos de referencia. Si está fuera de rango, se alerta pero NO se bloquea (RF-16).
    let fueraDeRango = false;
    let alerta = null;

    if (this.rulesServiceClient && typeof this.rulesServiceClient.evaluateRate === 'function') {
      try {
        const rateResult = await this.rulesServiceClient.evaluateRate({
          tenantId: user.tenantId,
          solicitudId,
          basePrice: totalCalculado,
        });
        if (rateResult && rateResult.fueraDeRango) {
          fueraDeRango = true;
          alerta = rateResult.alerta || 'La cotización excede el tarifario de referencia del tenant';
        }
      } catch {
        // En caso de que no haya servicio externo, no bloquea el flujo principal
      }
    } else {
      // Tarifario por defecto de referencia: si el total excede un umbral típico razonable (ej. 1'000.000 COP)
      if (totalCalculado > 1000000) {
        fueraDeRango = true;
        alerta = 'La cotización excede el tarifario de referencia del tenant';
      }
    }

    // Historial y versionado de cotizaciones para la solicitud (SAD §6.4: version incremental)
    const cotizacionesPrevias = await this.cotizacionRepository.findBySolicitudId(solicitudId);
    const version = cotizacionesPrevias.length + 1;

    const nuevaCotizacion = new Cotizacion({
      solicitudId,
      aliadoId: user.userId,
      valorManoObra: manoObraRedondeada,
      valorMateriales: materialesRedondeados,
      valor: totalCalculado,
      moneda: moneda || 'COP',
      fueraDeRango,
      estado: 'PENDIENTE',
      version,
      observacion: observacion ? String(observacion).trim() : null,
    });

    const cotizacionGuardada = await this.cotizacionRepository.create(nuevaCotizacion);

    // Actualiza el estado de la solicitud a COTIZANDO y asocia al aliado
    const estadoAnterior = solicitud.estado;
    solicitud.estado = 'COTIZANDO';
    if (!solicitud.aliadoId) {
      solicitud.aliadoId = user.userId;
    }
    await this.solicitudRepository.update(solicitud);

    // Registra en el log/historial de la solicitud
    await this.historialSolicitudRepository.create({
      solicitudId,
      usuarioId: user.userId,
      estadoAnterior,
      estadoNuevo: 'COTIZANDO',
      observacion: `Cotización v${version} enviada: Mano de obra ${manoObraRedondeada}, Materiales ${materialesRedondeados}, Total ${totalCalculado}`,
    });

    return {
      cotizacion: cotizacionGuardada,
      fueraDeRango,
      alerta,
    };
  }
}

module.exports = CreateQuoteUseCase;
