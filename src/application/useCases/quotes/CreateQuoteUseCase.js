const { ValidationError } = require('../../../domain/errors/DomainError');
const { contextoDeSesion, exigirRol, solicitudIdValido } = require('./quoteAccess');
const { entregarAviso } = require('../notifications/entregarAviso');

// DECIMAL(12, 2) de `cotizacion`: hasta diez dígitos enteros y dos decimales.
const IMPORTE_RE = /^\d{1,10}(\.\d{1,2})?$/;

function invalido(mensaje) {
  return new ValidationError(`MANI-COT-400: ${mensaje}`, 'MANI-COT-400');
}

// Acepta número o texto numérico, pero rechaza negativos, notación científica y más de dos decimales en lugar
// de redondearlos: el importe que se persiste es exactamente el que envió el aliado.
function importe(valor, campo) {
  if (valor === undefined || valor === null || valor === '') throw invalido(`${campo} es obligatorio`);
  if (typeof valor !== 'number' && typeof valor !== 'string') throw invalido(`${campo} debe ser numérico`);
  const texto = typeof valor === 'number' ? String(valor) : valor.trim();
  if (!IMPORTE_RE.test(texto)) {
    throw invalido(`${campo} debe ser un valor no negativo con máximo dos decimales`);
  }
  return Math.round(Number(texto) * 100);
}

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
