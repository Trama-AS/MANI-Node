const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { contratoDeProveedorDePagos, contratoDeProveedorPush } = require('./providerContracts');
const { PROVIDERS: PAYMENT_PROVIDERS } = require('../../../src/infrastructure/payments/createPaymentProvider');
const { crearFakeSandboxPagos } = require('../../helpers/fakeSandboxPagos');
const { PROVIDERS: PUSH_PROVIDERS } = require('../../../src/infrastructure/push/createPushProvider');

// SCRUM-1240 (ARQ-09): cada adaptador registrado en las fábricas pasa el contrato de su puerto. Agregar un proveedor
// real a PROVIDERS lo somete a estas mismas pruebas sin escribir nada nuevo aquí.
describe('Contratos de adaptadores de proveedores', () => {
  test('cada fábrica tiene al menos un adaptador registrado, así el contrato nunca corre vacío', () => {
    // SCRUM-1725 (QAS-26): pagos tiene dos adaptadores intercambiables, igual que push.
    assert.ok(Object.keys(PAYMENT_PROVIDERS).length >= 2);
    assert.ok(Object.keys(PUSH_PROVIDERS).length > 0);
  });

  describe('pagos', () => {
    for (const [nombre, crear] of Object.entries(PAYMENT_PROVIDERS)) {
      // SCRUM-1725: el adaptador por HTTP corre contra un doble del sandbox; el mock ignora el argumento.
      contratoDeProveedorDePagos(nombre, () =>
        crear({ url: 'https://sandbox-pagos.example.test', fetchImpl: crearFakeSandboxPagos().fetch })
      );
    }
  });

  describe('push', () => {
    for (const [nombre, crear] of Object.entries(PUSH_PROVIDERS)) {
      // SCRUM-1662: un adaptador con falla inyectable (mock_falla) cumple el contrato con la falla desactivada (`fallas: 0`);
      // los demás ignoran el argumento. Su comportamiento con falla va en sus propias pruebas.
      contratoDeProveedorPush(nombre, () => crear({ fallas: 0 }));
    }
  });
});
