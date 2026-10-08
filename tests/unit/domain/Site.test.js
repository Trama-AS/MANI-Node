const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Site = require('../../../src/domain/entities/Site');

describe('Site Domain Entity (RF-08 / RF-09)', () => {
  it('debe crear un sitio válido con zona obligatoria y dirección válida', () => {
    const site = new Site({
      tenantId: 'tenant-trama-1',
      clienteId: 'client-123',
      nombre: 'Sede Principal',
      direccion: 'Calle 100 # 15-20',
      zonaId: 'zona-norte',
    });

    assert.doesNotThrow(() => site.validate());
    assert.strictEqual(site.tenantId, 'tenant-trama-1');
    assert.strictEqual(site.nombre, 'Sede Principal');
    assert.strictEqual(site.zonaId, 'zona-norte');
  });

  it('debe fallar si falta el tenantId', () => {
    const site = new Site({
      tenantId: '',
      direccion: 'Carrera 7 # 72-10',
      zonaId: 'zona-1',
    });

    assert.throws(() => site.validate(), /tenantId es requerido/);
  });

  it('debe fallar si la dirección es demasiado corta', () => {
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
