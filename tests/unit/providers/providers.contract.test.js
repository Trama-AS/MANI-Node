const { contratoDeProveedorDePagos, contratoDeProveedorPush } = require('./providerContracts');
const { PROVIDERS: PAYMENT_PROVIDERS } = require('../../../src/infrastructure/payments/createPaymentProvider');
const { PROVIDERS: PUSH_PROVIDERS } = require('../../../src/infrastructure/push/createPushProvider');

// SCRUM-1240 (ARQ-09): cada adaptador registrado en las fábricas pasa el contrato de su puerto. Agregar un proveedor
// real a PROVIDERS lo somete a estas mismas pruebas sin escribir nada nuevo aquí.
for (const [nombre, crear] of Object.entries(PAYMENT_PROVIDERS)) {
  contratoDeProveedorDePagos(nombre, crear);
}
for (const [nombre, crear] of Object.entries(PUSH_PROVIDERS)) {
  contratoDeProveedorPush(nombre, crear);
}
