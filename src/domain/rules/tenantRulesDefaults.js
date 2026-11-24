/**
 * Reglas operativas del tenant (SCRUM-1366). Quien las valida es Rules (SCRUM-1722 / QAS-21): Core guarda las
 * normalizadas que Rules devuelve. Aquí solo quedan las de omisión (versión 0) y la comprobación que hace la
 * liquidación al leer una comisión ya guardada.
 */
const REGLAS_POR_OMISION = Object.freeze({
  ordenListado: { criterio: 'CALIFICACION' },
  alertaTarifa: { toleranciaPorcentaje: 10 },
  comision: { porcentaje: 10 },
  cancelacion: { ventanaHoras: 2, penalizacionPorcentaje: 20 },
  oferta: { minutosParaAceptar: 15 }
});

const COMISION_MAXIMA = 30;

/**
 * La columna liquidacion.porcentaje_comision guarda 2 decimales: con más, el porcentaje guardado no cuadraría con la
 * comisión calculada. Lo usa la liquidación al leer la comisión guardada; al guardarla, el mismo límite lo aplica Rules.
 */
function comisionValida(valor) {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= 0 &&
    valor <= COMISION_MAXIMA &&
    Number(valor.toFixed(2)) === valor
  );
}

module.exports = {
  COMISION_MAXIMA,
  comisionValida,
  REGLAS_POR_OMISION
};
