/* eslint-disable no-unused-vars */

/**
 * Puerto de dominio para el Módulo M-08:
 * - Calificación cliente -> aliado (SCRUM-874) y aliado -> cliente (SCRUM-875)
 * - Cierre condicionado a calificación bidireccional (SCRUM-1418)
 * - Calificación agregada visible en el listado de aliados (SCRUM-876)
 * - Penalización por cancelación tardía según política vigente por tenant (SCRUM-878)
 * - Historial cronológico de servicios del cliente (SCRUM-879) y de trabajos del aliado (SCRUM-880)
 */
class IRatingsRepository {
  async registrarCalificacion(ctx, datos) {
    throw new Error('IRatingsRepository.registrarCalificacion no implementado');
  }

  async consultarCalificacionesYCierre(ctx, solicitudId) {
    throw new Error('IRatingsRepository.consultarCalificacionesYCierre no implementado');
  }

  async cerrarSolicitud(ctx, solicitudId) {
    throw new Error('IRatingsRepository.cerrarSolicitud no implementado');
  }

  async listarReputacionAliados(ctx, filtros) {
    throw new Error('IRatingsRepository.listarReputacionAliados no implementado');
  }

  async obtenerReputacionAliado(ctx, aliadoId) {
    throw new Error('IRatingsRepository.obtenerReputacionAliado no implementado');
  }

  async obtenerPoliticaCancelacion(ctx) {
    throw new Error('IRatingsRepository.obtenerPoliticaCancelacion no implementado');
  }

  async configurarPoliticaCancelacion(ctx, politica) {
    throw new Error('IRatingsRepository.configurarPoliticaCancelacion no implementado');
  }

  async previsualizarCancelacion(ctx, solicitudId) {
    throw new Error('IRatingsRepository.previsualizarCancelacion no implementado');
  }

  async listarHistorialCliente(ctx, filtros) {
    throw new Error('IRatingsRepository.listarHistorialCliente no implementado');
  }

  async listarHistorialAliado(ctx, filtros) {
    throw new Error('IRatingsRepository.listarHistorialAliado no implementado');
  }

  async obtenerTrabajoAliado(ctx, solicitudId) {
    throw new Error('IRatingsRepository.obtenerTrabajoAliado no implementado');
  }
}

module.exports = IRatingsRepository;
