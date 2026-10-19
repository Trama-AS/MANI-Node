// Evidencia de SCRUM-1265 (QA4-02): PR bloqueado por el Quality Gate de SonarQube.
// Este archivo NO se fusiona. Es código sin pruebas a propósito, para que la
// cobertura de código nuevo quede por debajo del 80 % y el gate falle.

// TODO: archivo de evidencia, se descarta al cerrar el PR sin fusionar.
function calcularTotalPedido(items, impuesto) {
  let subtotal = 0;
  for (const item of items) {
    if (item.cantidad > 0) {
      subtotal += item.cantidad * item.precio;
    } else if (item.descuento) {
      subtotal -= item.descuento;
    }
  }
  if (subtotal < 0) {
    subtotal = 0;
  }
  const total = subtotal * (1 + (impuesto || 0));
  return Math.round(total * 100) / 100;
}

function resumirPedido(items, impuesto) {
  const total = calcularTotalPedido(items, impuesto);
  const cantidad = items.reduce((acc, item) => acc + (item.cantidad || 0), 0);
  return { total, cantidad, vacio: cantidad === 0 };
}

function clasificarPedido(items, impuesto) {
  const { total, cantidad, vacio } = resumirPedido(items, impuesto);
  if (vacio) {
    return 'VACIO';
  }
  if (total > 1000000) {
    return 'GRANDE';
  }
  if (total > 100000) {
    return 'MEDIANO';
  }
  if (cantidad > 10) {
    return 'MUCHOS_ITEMS';
  }
  return 'PEQUENO';
}

function validarItems(items) {
  const errores = [];
  for (const item of items) {
    if (typeof item.precio !== 'number') {
      errores.push('precio invalido');
    }
    if (typeof item.cantidad !== 'number') {
      errores.push('cantidad invalida');
    }
  }
  return errores;
}

module.exports = { calcularTotalPedido, resumirPedido, clasificarPedido, validarItems };
