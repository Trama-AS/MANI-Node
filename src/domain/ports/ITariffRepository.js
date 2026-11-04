/**
 * Puerto del tarifario de referencia (M-10: SCRUM-885, SCRUM-886, SCRUM-887; RF-22, RF-23).
 * Core persiste las tarifas por categoría y tenant; Rules las usa para evaluar cotizaciones (Mesa CFG-23a punto M2).
 * Todo método recibe el contexto verificado del JWT `{ tenantId, userId, role }` (T4).
 */
class ITariffRepository {
  /** Crea la primera versión ACTIVA de una tarifa (o una con vigencia que no se cruza). */
  async crear(_ctx, _datos) {
    throw new Error('Método crear() no implementado en ITariffRepository');
  }

  /** Marca la versión `tarifaId` REEMPLAZADA y crea la siguiente con los datos nuevos, en una transacción. */
  async reemplazar(_ctx, _datos) {
    throw new Error('Método reemplazar() no implementado en ITariffRepository');
  }

  /** Tarifas ACTIVA del tenant, opcionalmente de una categoría. */
  async listarActivas(_ctx, _filtro) {
    throw new Error('Método listarActivas() no implementado en ITariffRepository');
  }

  /** Todas las versiones de una categoría, de la más reciente a la más antigua. */
  async historial(_ctx, _filtro) {
    throw new Error('Método historial() no implementado en ITariffRepository');
  }

  /** `{ disponible, tarifa }` con la tarifa vigente en `fecha` para la categoría de una solicitud visible a la sesión. */
  async vigenteParaSolicitud(_ctx, _datos) {
    throw new Error('Método vigenteParaSolicitud() no implementado en ITariffRepository');
  }

  /** Cotizaciones emitidas en el periodo con la tarifa que regía al emitirlas (`tarifa: null` si no había). */
  async cotizacionesConTarifa(_ctx, _periodo) {
    throw new Error('Método cotizacionesConTarifa() no implementado en ITariffRepository');
  }
}

module.exports = ITariffRepository;
