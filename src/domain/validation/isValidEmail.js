/**
 * Valida el formato básico de un correo sin expresiones regulares con
 * backtracking (regla javascript:S8786 de SonarQube, riesgo de ReDoS).
 *
 * Acepta exactamente lo mismo que la expresión anterior
 * /^[^\s@]+@[^\s@]+\.[^\s@]+$/: sin espacios, una sola arroba con texto antes,
 * y en el dominio al menos un punto que tenga un carácter antes y otro después.
 */
function isValidEmail(email) {
  if (typeof email !== 'string' || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  return parts[1].slice(1, -1).includes('.');
}

module.exports = isValidEmail;
