const crypto = require('node:crypto');
const IPaymentProvider = require('../../domain/ports/IPaymentProvider');
const PaymentProviderError = require('../../domain/errors/PaymentProviderError');

// Desenlaces que el sandbox permite elegir para recorrer cada camino sin datos de tarjeta (HU-M11-01 C1 y C2).
const ESCENARIOS = ['APROBADO', 'RECHAZADO', 'PENDIENTE', 'TIMEOUT', 'RESPUESTA_INVALIDA'];

const MOTIVO_RECHAZO = 'Fondos insuficientes (rechazo simulado del sandbox)';

/**
 * Proveedor de pagos simulado (SCRUM-1432, CONS-38): no llama a ninguna red ni mueve dinero. El escenario lo elige
 * quien prueba; sin escenario aprueba. No recibe ni guarda datos de tarjeta.
 */
class MockPaymentProvider extends IPaymentProvider {
  constructor({ idFactory = () => crypto.randomUUID() } = {}) {
    super();
    this.idFactory = idFactory;
  }

  get name() {
    return 'mock';
  }

  get simulated() {
    return true;
  }

  async charge({ escenario = 'APROBADO' } = {}) {
    if (!ESCENARIOS.includes(escenario)) {
      throw new PaymentProviderError('INVALID_RESPONSE', `Escenario desconocido: ${escenario}`);
    }
    if (escenario === 'TIMEOUT') {
      throw new PaymentProviderError('TIMEOUT', 'El proveedor simulado no respondió a tiempo');
    }
    // Una respuesta que el contrato no permite: el caso de uso debe tratarla como fallo, no como éxito.
    if (escenario === 'RESPUESTA_INVALIDA') return { estado: 'DESCONOCIDO' };

    const referencia = `mock-pay-${this.idFactory()}`;
    if (escenario === 'RECHAZADO') return { estado: 'RECHAZADO', referencia, motivo: MOTIVO_RECHAZO };
    return { estado: escenario, referencia };
  }
}

MockPaymentProvider.ESCENARIOS = ESCENARIOS;
module.exports = MockPaymentProvider;
