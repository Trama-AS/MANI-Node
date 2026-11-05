const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Site = require('../../../src/domain/entities/Site');

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
    assert.strictEqual(site.clientId, 'client-uuid-001');
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

describe('Site: coordenadas de la sede (HU-M04-07 / SCRUM-1396)', () => {


  it('Site conserva las coordenadas y las normaliza a número cuando llegan como cadena', () => {
  // PostgreSQL devuelve `numeric` como cadena; la entidad no debe propagarla así.
  const s = new Site({
    tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1',
    latitud: '4.681320', longitud: '-74.050450',
  });

  assert.equal(s.latitud, 4.68132);
  assert.equal(s.longitud, -74.05045);
  assert.equal(typeof s.latitud, 'number');
  assert.equal(s.tieneCoordenadas(), true);
  assert.equal(s.toJSON().latitud, 4.68132);
  });

  it('una sede sin coordenadas no las inventa y lo declara', () => {
  const s = new Site({ tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1' });

  assert.equal(s.latitud, null);
  assert.equal(s.longitud, null);
  assert.equal(s.tieneCoordenadas(), false);
  });

// Un punto a medias no se puede dibujar y esconde un error de captura.
  it('con una sola coordenada se descartan las dos', () => {
  for (const parcial of [{ latitud: 4.68 }, { longitud: -74.05 }]) {
    const s = new Site({ tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1', ...parcial });
    assert.equal(s.tieneCoordenadas(), false);
    assert.equal(s.latitud, null);
    assert.equal(s.longitud, null);
  }
  });

  it('un valor no numérico se trata como ausencia, no como cero', () => {
  const s = new Site({
    tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1',
    latitud: 'norte', longitud: 'occidente',
  });

  assert.equal(s.latitud, null, 'nunca 0: el ecuador no es un valor por omisión');
  assert.equal(s.tieneCoordenadas(), false);
  });

  it('validate rechaza coordenadas fuera del rango de WGS84', () => {
  for (const fuera of [{ latitud: 91, longitud: 0 }, { latitud: -91, longitud: 0 }, { latitud: 0, longitud: 181 }, { latitud: 0, longitud: -181 }]) {
    const s = new Site({ tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1', ...fuera });
    assert.throws(() => s.validate(), { code: 'VALIDATION_ERROR' });
  }
  });

  it('validate acepta un punto de Bogotá y los extremos del rango', () => {
  for (const dentro of [{ latitud: 4.68132, longitud: -74.05045 }, { latitud: 90, longitud: 180 }, { latitud: -90, longitud: -180 }]) {
    const s = new Site({ tenantId: 't1', direccion: 'Calle 100 # 10-20', zonaId: 'z1', ...dentro });
    assert.equal(s.validate(), true);
  }
  });

});
