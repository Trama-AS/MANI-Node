// DECIMAL(12, 2) de `cotizacion` y `adicion_servicio`: hasta diez dígitos enteros y dos decimales.
const IMPORTE_RE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Importe en centavos, para que las sumas no arrastren errores de coma flotante. Acepta número o texto numérico,
 * pero rechaza negativos, notación científica y más de dos decimales en lugar de redondearlos: el importe que se
 * persiste es exactamente el que se envió. Lo comparten la cotización (SCRUM-865) y la adición (SCRUM-872).
 * @param {unknown} valor
 * @param {string} campo nombre del campo, para el mensaje
 * @param {(mensaje: string) => Error} invalido error de validación con el código del dominio que llama
 * @returns {number} centavos
 */
function centavos(valor, campo, invalido) {
  if (valor === undefined || valor === null || valor === '') throw invalido(`${campo} es obligatorio`);
  if (typeof valor !== 'number' && typeof valor !== 'string') throw invalido(`${campo} debe ser numérico`);
  const texto = typeof valor === 'number' ? String(valor) : valor.trim();
  if (!IMPORTE_RE.test(texto)) {
    throw invalido(`${campo} debe ser un valor no negativo con máximo dos decimales`);
  }
  return Math.round(Number(texto) * 100);
}

module.exports = { centavos };
