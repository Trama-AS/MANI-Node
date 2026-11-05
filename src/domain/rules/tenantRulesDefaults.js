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
 * comisión calculada. Lo usan quien guarda la regla y quien liquida.
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

const CRITERIOS_ORDEN_VALIDOS = new Set(['CALIFICACION', 'COBERTURA']);

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Número JSON dentro de [min, max]. No convierte: `null`, `true`, `""`, `"15"` o `[]` se rechazan (C2 de SCRUM-1366),
 * porque `Number()` los convertía en 0, 1 o 15 y se guardaban como si fueran válidos.
 */
function numero(valor, min, max, mensaje, invalidoFn, { entero = false } = {}) {
  const valido =
    typeof valor === 'number' && Number.isFinite(valor) && valor >= min && valor <= max && (!entero || Number.isInteger(valor));
  if (!valido) throw invalidoFn(mensaje);
  return valor;
}

function seccion(reglas, nombre, invalidoFn) {
  if (!esObjeto(reglas[nombre])) throw invalidoFn(`${nombre} es obligatorio y debe ser un objeto`);
  return reglas[nombre];
}

function validarReglasOperativas(reglas, invalidoFn) {
  if (!esObjeto(reglas)) {
    throw invalidoFn('reglas debe ser un objeto JSON');
  }

  // 1. ordenListado (RF-13)
  const orden = seccion(reglas, 'ordenListado', invalidoFn);
  const criterio = typeof orden.criterio === 'string' ? orden.criterio.trim().toUpperCase() : '';
  if (!CRITERIOS_ORDEN_VALIDOS.has(criterio)) {
    throw invalidoFn('ordenListado.criterio debe ser CALIFICACION o COBERTURA');
  }

  // 2. alertaTarifa (RF-16)
  const tol = numero(
    seccion(reglas, 'alertaTarifa', invalidoFn).toleranciaPorcentaje,
    0,
    50,
    'alertaTarifa.toleranciaPorcentaje debe ser un número entre 0 y 50',
    invalidoFn
  );

  // 3. comision (RNF-10)
  const comPct = seccion(reglas, 'comision', invalidoFn).porcentaje;
  if (!comisionValida(comPct)) {
    throw invalidoFn(`comision.porcentaje debe ser un número entre 0 y ${COMISION_MAXIMA}, con máximo 2 decimales`);
  }

  // 4. cancelacion (RNF-10)
  const canc = seccion(reglas, 'cancelacion', invalidoFn);
  const ventana = numero(canc.ventanaHoras, 0, 72, 'cancelacion.ventanaHoras debe ser un número entre 0 y 72', invalidoFn);
  const penalizacion = numero(
    canc.penalizacionPorcentaje,
    0,
    100,
    'cancelacion.penalizacionPorcentaje debe ser un número entre 0 y 100',
    invalidoFn
  );
  if (penalizacion > 0 && ventana === 0) {
    throw invalidoFn('cancelacion incompatible: penalizacionPorcentaje > 0 exige ventanaHoras > 0');
  }

  // 5. oferta (RNF-10)
  const minAceptar = numero(
    seccion(reglas, 'oferta', invalidoFn).minutosParaAceptar,
    1,
    1440,
    'oferta.minutosParaAceptar debe ser un número entero entre 1 y 1440',
    invalidoFn,
    { entero: true }
  );

  return {
    ordenListado: { criterio },
    alertaTarifa: { toleranciaPorcentaje: tol },
    comision: { porcentaje: comPct },
    cancelacion: { ventanaHoras: ventana, penalizacionPorcentaje: penalizacion },
    oferta: { minutosParaAceptar: minAceptar }
  };
}

module.exports = {
  COMISION_MAXIMA,
  comisionValida,
  REGLAS_POR_OMISION,
  CRITERIOS_ORDEN_VALIDOS,
  validarReglasOperativas
};
