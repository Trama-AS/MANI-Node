const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Site } = require('../../../src/features/client/domain/Site');

describe('Site Domain Entity (RF-08 / RF-09)', () => {
  it('debe crear un sitio válido con zona obligatoria y reglas contextuales', () => {
    const site = new Site({
      tenantId: 'tenant-trama-1',
      clienteId: 'client-123',
      nombre: 'Sede Norte',
      direccion: 'Carrera 15 # 93-47 Oficina 301',
      zonaId: 'zona-bogota-norte',
      reglas: { horarioAcceso: '07:00 - 19:00', requiereEPI: true },
    });

    assert.doesNotThrow(() => site.validate());
    assert.strictEqual(site.nombre, 'Sede Norte');
    assert.strictEqual(site.zonaId, 'zona-bogota-norte');
    assert.deepStrictEqual(site.reglas, { horarioAcceso: '07:00 - 19:00', requiereEPI: true });
  });

  it('debe fallar si falta el tenantId', () => {
    const site = new Site({
      tenantId: '',
      direccion: 'Calle 100 # 15-20',
      zonaId: 'zona-1',
    });

    assert.throws(() => site.validate(), /tenantId es requerido/);
  });

  it('debe fallar si la dirección es demasiado corta o vacía', () => {
    const site = new Site({
      tenantId: 'tenant-1',
      direccion: 'Cl 1',
      zonaId: 'zona-1',
    });

    assert.throws(() => site.validate(), /direccion del sitio es requerida/);
  });

  it('debe fallar si falta la zonaId (regla RF-09)', () => {
    const site = new Site({
      tenantId: 'tenant-1',
      direccion: 'Calle 100 # 15-20',
      zonaId: '',
    });

    assert.throws(() => site.validate(), /zonaId es requerida/);
  });
});
