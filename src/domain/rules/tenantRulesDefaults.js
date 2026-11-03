const REGLAS_POR_OMISION = Object.freeze({
  ordenListado: { criterio: 'CALIFICACION' },
  alertaTarifa: { toleranciaPorcentaje: 10 },
  comision: { porcentaje: 15 },
  cancelacion: { ventanaHoras: 2, penalizacionPorcentaje: 20 },
  oferta: { minutosParaAceptar: 15 }
});

const CRITERIOS_ORDEN_VALIDOS = new Set(['CALIFICACION', 'COBERTURA']);

function validarReglasOperativas(reglas, invalidoFn) {
  if (!reglas || typeof reglas !== 'object' || Array.isArray(reglas)) {
    throw invalidoFn('reglas debe ser un objeto JSON');
  }

  // 1. ordenListado (RF-13)
  const orden = reglas.ordenListado;
  if (!orden || typeof orden !== 'object') {
    throw invalidoFn('ordenListado es obligatorio y debe ser un objeto');
  }
  const criterio = String(orden.criterio || '').trim().toUpperCase();
  if (!CRITERIOS_ORDEN_VALIDOS.has(criterio)) {
    throw invalidoFn('ordenListado.criterio debe ser CALIFICACION o COBERTURA');
  }

  // 2. alertaTarifa (RF-16)
  const alerta = reglas.alertaTarifa;
  if (!alerta || typeof alerta !== 'object') {
    throw invalidoFn('alertaTarifa es obligatorio y debe ser un objeto');
  }
  const tol = Number(alerta.toleranciaPorcentaje);
  if (!Number.isFinite(tol) || tol < 0 || tol > 50) {
    throw invalidoFn('alertaTarifa.toleranciaPorcentaje debe ser un número entre 0 y 50');
  }

  // 3. comision (RNF-10)
  const comision = reglas.comision;
  if (!comision || typeof comision !== 'object') {
    throw invalidoFn('comision es obligatorio y debe ser un objeto');
  }
  const comPct = Number(comision.porcentaje);
  if (!Number.isFinite(comPct) || comPct < 0 || comPct > 30) {
    throw invalidoFn('comision.porcentaje debe ser un número entre 0 y 30');
  }

  // 4. cancelacion (RNF-10)
  const canc = reglas.cancelacion;
  if (!canc || typeof canc !== 'object') {
    throw invalidoFn('cancelacion es obligatorio y debe ser un objeto');
  }
  const ventana = Number(canc.ventanaHoras);
  const penalizacion = Number(canc.penalizacionPorcentaje);
  if (!Number.isFinite(ventana) || ventana < 0 || ventana > 72) {
    throw invalidoFn('cancelacion.ventanaHoras debe ser un número entero o decimal entre 0 y 72');
  }
  if (!Number.isFinite(penalizacion) || penalizacion < 0 || penalizacion > 100) {
    throw invalidoFn('cancelacion.penalizacionPorcentaje debe ser un número entre 0 y 100');
  }
  if (penalizacion > 0 && ventana === 0) {
    throw invalidoFn('cancelacion incompatible: penalizacionPorcentaje > 0 exige ventanaHoras > 0');
  }

  // 5. oferta (RNF-10)
  const oferta = reglas.oferta;
  if (!oferta || typeof oferta !== 'object') {
    throw invalidoFn('oferta es obligatorio y debe ser un objeto');
  }
  const minAceptar = Number(oferta.minutosParaAceptar);
  if (!Number.isInteger(minAceptar) || minAceptar < 1 || minAceptar > 1440) {
    throw invalidoFn('oferta.minutosParaAceptar debe ser un número entero entre 1 y 1440');
  }

  return {
    ordenListado: { criterio },
    alertaTarifa: { toleranciaPorcentaje: tol },
    comision: { porcentaje: comPct },
    cancelacion: { ventanaHoras: ventana, penalizacionPorcentaje: penalizacion },
    oferta: { minutosParaAceptar: minAceptar }
  };
}

module.exports = {
  REGLAS_POR_OMISION,
  CRITERIOS_ORDEN_VALIDOS,
  validarReglasOperativas
};
