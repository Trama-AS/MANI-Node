process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const container = require('../../../src/container');
const { updateSite } = require('../../../src/controllers/clients.controller');
const ICompanyClientRepository = require('../../../src/domain/ports/ICompanyClientRepository');

function respuesta() {
  return {
    statusCode: null,
    body: null,
    getHeader: () => 'corr-1387',
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('clients.controller updateSite (SCRUM-1387)', () => {
  const original = container.updateCompanyClientSiteUseCase;
  afterEach(() => {
    container.updateCompanyClientSiteUseCase = original;
  });

  it('responde 401 si el token no trae tenant y no llama al caso de uso', async () => {
    let llamado = false;
    container.updateCompanyClientSiteUseCase = { execute: async () => (llamado = true) };
    const res = respuesta();

    await updateSite({ user: { role: 'ADMIN' }, params: {}, headers: {}, body: {} }, res, () => {});

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    assert.strictEqual(res.body.correlationId, 'corr-1387');
    assert.strictEqual(llamado, false);
  });

  it('pasa al manejador global un error que no es de dominio', async () => {
    const falla = new Error('base caída');
    container.updateCompanyClientSiteUseCase = {
      execute: async () => {
        throw falla;
      },
    };
    let recibido;

    await updateSite(
      { user: { tenantId: 't-1', role: 'ADMIN', userId: 'u-1' }, params: { id: 'c', siteId: 's' }, headers: {}, body: { nombre: 'X' } },
      respuesta(),
      (err) => (recibido = err)
    );

    assert.strictEqual(recibido, falla);
  });
});

describe('ICompanyClientRepository (puerto) — operaciones de edición de sede', () => {
  it('findSiteById y updateSite exigen implementación en el adaptador', async () => {
    const puerto = new ICompanyClientRepository();
    await assert.rejects(puerto.findSiteById('c', 's', 't'), /findSiteById\(\) no implementado/);
    await assert.rejects(puerto.updateSite('c', 't', {}), /updateSite\(\) no implementado/);
    await assert.rejects(puerto.findByUsuarioId('u', 't'), /findByUsuarioId\(\) no implementado/);
  });
});
