const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Site } = require('../../../src/features/client/domain/Site');

describe('Site Domain Entity (RF-08 / RF-09)', () => {
  it('debe crear un sitio válido con zona obligatoria y reglas contextuales', () => {
    const site = new Site({
      tenantId: 'tenant-trama-1',
      clienteId: 'client-uuid-001',
      nombre: 'Sede Principal Calle 100',
      direccion: 'Calle 100 # 15-20, Oficina 501',
      zonaId: 'zona-bogota-norte',
      reglas: {
        requiereEpi: true,
        horarioAcceso: '08:00-17:00',
        parqueaderoDisponible: true,
      },
    });

    assert.doesNotThrow(() => site.validate());
    assert.strictEqual(site.tenantId, 'tenant-trama-1');
    assert.strictEqual(site.nombre, 'Sede Principal Calle 100');
    assert.strictEqual(site.zonaId, 'zona-bogota-norte');
    assert.strictEqual(site.reglas.requiereEpi, true);
  });

  it('debe fallar si falta el tenantId', () => {
    const site = new Site({
      tenantId: '',
      direccion: 'Carrera 7 # 72-10',
      zonaId: 'zona-1',
    });

    assert.throws(() => site.validate(), /tenantId es requerido/);
  });

  it('debe fallar si la dirección es demasiado corta o vacía', () => {
    const site = new Site({
      tenantId: 'tenant-1',
      direccion: 'Cra',
      zonaId: 'zona-1',
    });

    assert.throws(() => site.validate(), /direccion del sitio es requerida/);
  });

  it('debe fallar si falta la zonaId (regla RF-09)', () => {
    const site = new Site({
      tenantId: 'tenant-1',
      direccion: 'Carrera 15 # 85-30',
      zonaId: '',
    });

    assert.throws(() => site.validate(), /zonaId es requerida/);
  });
});
