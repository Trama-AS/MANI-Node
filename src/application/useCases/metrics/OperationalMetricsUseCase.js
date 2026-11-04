const { dominio } = require('../sesionDeDominio');

const { sesion, periodo } = dominio('MANI-MET');

const MAX_DIAS = 366;

const proporcion = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 10000 : null);

/**
 * Métricas operativas por tenant (SCRUM-900 / HU-M12-06, RF-28). El administrador del tenant consulta agregados de un
 * periodo con fechas inclusive en hora de Colombia. Todo sale de la base del tenant de la sesión (C3); un periodo sin
 * datos da ceros y tasas nulas, nunca valores de demostración (C2).
 */
class OperationalMetricsUseCase {
  constructor({ metricsRepository }) {
    if (!metricsRepository) throw new Error('metricsRepository es requerido para OperationalMetricsUseCase');
    this.metricsRepository = metricsRepository;
  }

  async consultar({ user, query = {} }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant consulta las métricas operativas');
    const rango = periodo(query, MAX_DIAS);
    const m = await this.metricsRepository.agregados(ctx, rango);

    return {
      periodo: { ...rango, zonaHoraria: 'America/Bogota' },
      solicitudes: {
        creadas: m.solicitudesCreadas,
        porEstado: m.solicitudesPorEstado,
        finalizadas: m.solicitudesFinalizadas,
        canceladas: m.solicitudesCanceladas,
        tasaCancelacion: proporcion(m.solicitudesCanceladas, m.solicitudesCreadas),
      },
      cotizaciones: {
        emitidas: m.cotizacionesEmitidas,
        aceptadas: m.cotizacionesAceptadas,
        tasaAceptacion: proporcion(m.cotizacionesAceptadas, m.cotizacionesEmitidas),
      },
      pagos: { aprobados: m.pagosAprobados, montoAprobado: m.montoAprobado },
      calificaciones: { total: m.calificaciones, promedio: m.calificacionPromedio },
      quejas: { registradas: m.quejasRegistradas, abiertas: m.quejasAbiertas, cerradas: m.quejasCerradas },
      aliadosConServicios: m.aliadosConServicios,
    };
  }
}

module.exports = OperationalMetricsUseCase;
