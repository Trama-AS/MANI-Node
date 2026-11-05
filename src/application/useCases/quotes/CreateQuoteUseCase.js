const { ValidationError } = require('../../../domain/errors/DomainError');
const { contextoDeSesion, exigirRol, solicitudIdValido } = require('./quoteAccess');
const { entregarAviso } = require('../notifications/entregarAviso');
const { centavos } = require('./importe');

function invalido(mensaje) {
  return new ValidationError(`MANI-COT-400: ${mensaje}`, 'MANI-COT-400');
}

const importe = (valor, campo) => centavos(valor, campo, invalido);

/**
 * US-04.2.1 (SCRUM-865, RF-15): el aliado asignado emite una cotización con mano de obra y materiales
 * separados, y Core calcula el total. La versión la asigna Core.
 * La alerta contra el tarifario es de SCRUM-866 y la calcula Rules (SCRUM-1462): no bloquea el envío.
 */
class CreateQuoteUseCase {
  constructor({ quoteRepository, notificador = null }) {
    if (!quoteRepository) throw new Error('quoteRepository es requerido');
    this.quoteRepository = quoteRepository;
    // SCRUM-884: el cliente recibe el push de la cotización nueva. Opcional para probar sin notificaciones.
    this.notificador = notificador;
  }

  async execute({ user, solicitudId, body = {}, correlationId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['ALLY'], 'solo un aliado puede emitir cotizaciones');
    const id = solicitudIdValido(solicitudId);

    // Los importes se manejan en centavos para que el total no arrastre errores de coma flotante.
    const manoObra = importe(body.valorManoObra, 'valorManoObra');
    const materiales = importe(body.valorMateriales, 'valorMateriales');
    if (manoObra + materiales === 0) throw invalido('la cotización debe tener un total mayor que cero');

    if (body.total !== undefined && body.total !== null) {
      const total = Number(body.total);
      if (!Number.isFinite(total) || Math.round(total * 100) !== manoObra + materiales) {
        throw invalido('total no coincide con la suma de mano de obra y materiales');
      }
    }

    const { notificacionId, ...cotizacion } = await this.quoteRepository.emitir(ctx, {
      solicitudId: id,
      valorManoObra: manoObra / 100,
      valorMateriales: materiales / 100,
    });
    await entregarAviso(this.notificador, ctx, notificacionId, correlationId);
    return cotizacion;
  }
}

module.exports = CreateQuoteUseCase;
