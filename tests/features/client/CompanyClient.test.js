const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CompanyClient } = require('../../../src/features/client/domain/CompanyClient');

describe('CompanyClient Domain Entity', () => {
  it('debe crear una instancia válida de cliente empresa con tipo EMPRESA', () => {
    const client = new CompanyClient({
      tenantId: 'tenant-trama-1',
      razonSocial: 'Soluciones Integrales S.A.S.',
      nit: '901234567-1',
      email: 'gerencia@soluciones.com',
      telefono: '3101234567',
      nombreRepresentante: 'Alejandro Restrepo',
    });

    assert.doesNotThrow(() => client.validate());
    assert.strictEqual(client.tipo, 'EMPRESA');
    assert.strictEqual(client.estado, 'ACTIVO');
    assert.strictEqual(client.razonSocial, 'Soluciones Integrales S.A.S.');
  });

  it('debe fallar si falta el tenantId', () => {
    const client = new CompanyClient({
      tenantId: '',
      razonSocial: 'Empresa Test',
      nit: '900000000-1',
      email: 'test@empresa.com',
    });

    assert.throws(() => client.validate(), /tenantId es requerido/);
  });

  it('debe fallar si la razonSocial es demasiado corta o vacía', () => {
    const client = new CompanyClient({
      tenantId: 'tenant-1',
      razonSocial: 'A',
      nit: '900000000-1',
      email: 'test@empresa.com',
    });

    assert.throws(() => client.validate(), /razonSocial es requerida/);
  });

  it('debe fallar si el NIT es demasiado corto o vacío', () => {
    const client = new CompanyClient({
      tenantId: 'tenant-1',
      razonSocial: 'Empresa Valida',
      nit: '12',
      email: 'test@empresa.com',
    });

    assert.throws(() => client.validate(), /nit es requerido/);
  });

  it('debe fallar si el email no es válido', () => {
    const client = new CompanyClient({
      tenantId: 'tenant-1',
      razonSocial: 'Empresa Valida',
      nit: '900123456-7',
      email: 'correo-invalido',
    });

    assert.throws(() => client.validate(), /email corporativo inválido/);
  });
});
