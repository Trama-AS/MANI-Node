const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const RegisterCompanyClientWithSitesUseCase = require('../../../../src/application/useCases/clients/RegisterCompanyClientWithSitesUseCase');
const UpdateCompanyClientSiteUseCase = require('../../../../src/application/useCases/clients/UpdateCompanyClientSiteUseCase');
const GetCompanyClientSitesUseCase = require('../../../../src/application/useCases/clients/GetCompanyClientSitesUseCase');
const InMemoryCompanyClientRepository = require('../../../../src/infrastructure/repositories/InMemoryCompanyClientRepository');
const AddSiteToCompanyClientUseCase = require('../../../../src/application/useCases/clients/AddSiteToCompanyClientUseCase');
const { assertClientOwnerOrAdmin, cargarCliente } = require('../../../../src/application/useCases/clients/clientAccess');

const TENANT = 'tenant-trama-1';
const DUENO = 'usuario-dueno-1';

function esError(statusCode, code) {
  return (err) => {
    assert.strictEqual(err.statusCode, statusCode);
    if (code) assert.strictEqual(err.code, code);
    return true;
  };
}

describe('UpdateCompanyClientSiteUseCase (SCRUM-1387 / CONS-16 / RF-08)', () => {
  let repository;
  let useCase;
  let client;
  let sede;

  beforeEach(async () => {
    repository = new InMemoryCompanyClientRepository();
    const register = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: { createUser: async () => ({ userId: DUENO }) },
    });
    ({ client, sites: [sede] } = await register.execute({
      tenantId: TENANT,
      razonSocial: 'Retail Colombia S.A.S.',
      nit: '900987654-3',
      email: 'operaciones@retail.com',
      sitios: [
        {
          nombre: 'Sede Chapinero',
          direccion: 'Carrera 13 # 60-15',
          zonaId: 'zona-bogota-centro',
          reglas: { requiereEpi: true },
        },
      ],
    }));
    useCase = new UpdateCompanyClientSiteUseCase(repository);
  });

  const editar = (cambios, extra = {}) =>
    useCase.execute({
      clienteId: client.id,
      siteId: sede.id,
      tenantId: TENANT,
      cambios,
      userId: DUENO,
      userRole: 'CLIENT',
      ...extra,
    });

  it('C1: el cliente dueño edita nombre, dirección, zona y contacto y el cambio queda guardado', async () => {
    const editada = await editar({
      nombre: 'Sede Chapinero Alto',
      direccion: 'Carrera 7 # 64-20',
      zonaId: 'zona-bogota-chapinero',
      contactoNombre: 'Laura Gómez',
      contactoTelefono: '3001112233',
    });

    assert.strictEqual(editada.id, sede.id);
    assert.strictEqual(editada.nombre, 'Sede Chapinero Alto');
    assert.strictEqual(editada.zonaId, 'zona-bogota-chapinero');

    const { sites } = await new GetCompanyClientSitesUseCase(repository).execute({
      clienteId: client.id,
      tenantId: TENANT,
      userId: DUENO,
      userRole: 'CLIENT',
    });
    assert.strictEqual(sites.length, 1);
    assert.strictEqual(sites[0].direccion, 'Carrera 7 # 64-20');
    assert.strictEqual(sites[0].contactoNombre, 'Laura Gómez');
    assert.strictEqual(sites[0].contactoTelefono, '3001112233');
  });

  it('edición parcial: lo que no llega se conserva, incluidas las reglas del sitio', async () => {
    const editada = await editar({ nombre: 'Sede Renombrada' });

    assert.strictEqual(editada.nombre, 'Sede Renombrada');
    assert.strictEqual(editada.direccion, 'Carrera 13 # 60-15');
    assert.strictEqual(editada.zonaId, 'zona-bogota-centro');
    assert.deepStrictEqual(editada.reglas, { requiereEpi: true });
  });

  it('el contacto se puede borrar enviando null', async () => {
    await editar({ contactoNombre: 'Laura Gómez' });
    const editada = await editar({ contactoNombre: null });

    assert.strictEqual(editada.contactoNombre, null);
  });

  it('C4: el admin del tenant edita la sede de un cliente', async () => {
    const editada = await editar({ nombre: 'Sede Admin' }, { userId: 'admin-1', userRole: 'ADMIN' });

    assert.strictEqual(editada.nombre, 'Sede Admin');
  });

  for (const [caso, cambios] of [
    ['zona vacía', { zonaId: '' }],
    ['zona en blanco', { zonaId: '   ' }],
    ['dirección corta', { direccion: 'Cl 1' }],
    ['nombre vacío', { nombre: '  ' }],
    ['zona que no es texto', { zonaId: 42 }],
    ['dirección nula', { direccion: null }],
    ['cuerpo vacío', {}],
    ['campo desconocido', { clienteId: 'otro-cliente' }],
    ['reglas por esta ruta', { reglas: { requiereEpi: false } }],
  ]) {
    it(`C2: rechaza ${caso} con error de validación y no modifica la sede`, async () => {
      await assert.rejects(editar(cambios), esError(400, 'VALIDATION_ERROR'));

      const actual = await repository.findSiteById(client.id, sede.id, TENANT);
      assert.strictEqual(actual.nombre, 'Sede Chapinero');
      assert.strictEqual(actual.direccion, 'Carrera 13 # 60-15');
      assert.strictEqual(actual.zonaId, 'zona-bogota-centro');
    });
  }

  it('C2: un cuerpo que no es objeto se rechaza', async () => {
    await assert.rejects(editar(['nombre']), esError(400, 'VALIDATION_ERROR'));
    await assert.rejects(editar(null), esError(400, 'VALIDATION_ERROR'));
  });

  it('C3: desde otro tenant el cliente no existe (404 sin datos)', async () => {
    await assert.rejects(
      editar({ nombre: 'Intruso' }, { tenantId: 'tenant-B', userRole: 'ADMIN' }),
      esError(404, 'CLIENT_NOT_FOUND')
    );
  });

  it('C3: una sede de otro cliente del mismo tenant no se encuentra por este cliente (404)', async () => {
    const register = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: { createUser: async () => ({ userId: 'usuario-dueno-2' }) },
    });
    const { sites: [sedeAjena] } = await register.execute({
      tenantId: TENANT,
      razonSocial: 'Otra Empresa S.A.S.',
      nit: '900555444-1',
      email: 'otra@empresa.com',
      sitios: [{ nombre: 'Sede Ajena', direccion: 'Calle 80 # 10-20', zonaId: 'zona-1' }],
    });

    await assert.rejects(
      editar({ nombre: 'Robada' }, { siteId: sedeAjena.id, userRole: 'ADMIN' }),
      esError(404, 'SITE_NOT_FOUND')
    );
    const intacta = await repository.findSiteById(sedeAjena.clienteId, sedeAjena.id, TENANT);
    assert.strictEqual(intacta.nombre, 'Sede Ajena');
  });

  it('C4: otro cliente del mismo tenant recibe 403', async () => {
    await assert.rejects(editar({ nombre: 'Intruso' }, { userId: 'otro-cliente' }), esError(403, 'FORBIDDEN'));
  });

  it('C4: un aliado recibe 403 aunque su usuario coincida', async () => {
    await assert.rejects(editar({ nombre: 'Aliado' }, { userRole: 'ALLY' }), esError(403, 'FORBIDDEN'));
  });

  it('una sede que no existe responde 404', async () => {
    await assert.rejects(editar({ nombre: 'X' }, { siteId: 'sede-inexistente' }), esError(404, 'SITE_NOT_FOUND'));
  });

  it('si la sede desaparece entre la lectura y la escritura responde 404', async () => {
    repository.updateSite = async () => null;

    await assert.rejects(editar({ nombre: 'X' }), esError(404, 'SITE_NOT_FOUND'));
  });

  it('exige clienteId, siteId y tenantId', async () => {
    await assert.rejects(editar({ nombre: 'X' }, { clienteId: '' }), esError(400));
    await assert.rejects(editar({ nombre: 'X' }, { siteId: '' }), esError(400));
    await assert.rejects(editar({ nombre: 'X' }, { tenantId: '' }), esError(400));
  });

  it('exige el repositorio', () => {
    assert.throws(() => new UpdateCompanyClientSiteUseCase(), /repository es requerido/);
  });
});

describe('assertClientOwnerOrAdmin (SCRUM-1387, falla cerrada T9)', () => {
  const client = { id: 'c-1', usuarioId: DUENO };
  const permite = (params) => assert.doesNotThrow(() => assertClientOwnerOrAdmin({ client, mensaje: 'x', ...params }));
  const niega = (params) =>
    assert.throws(() => assertClientOwnerOrAdmin({ client, mensaje: 'x', ...params }), esError(403, 'FORBIDDEN'));

  it('deja pasar al admin del tenant y al cliente dueño, con el rol en cualquiera de sus formas', () => {
    permite({ userRole: 'ADMIN' });
    permite({ userRole: 'admin_tenant' });
    permite({ userRole: 'CLIENT', userId: DUENO });
    permite({ userRole: 'cliente', userId: DUENO });
  });

  it('niega sin rol, sin usuario, con otro usuario o si el cliente no tiene dueño conocido', () => {
    niega({});
    niega({ userId: DUENO });
    niega({ userRole: 'CLIENT' });
    niega({ userRole: 'CLIENT', userId: 'otro' });
    niega({ userRole: 'ALLY', userId: DUENO });
    assert.throws(
      () => assertClientOwnerOrAdmin({ client: { id: 'c-2' }, userRole: 'CLIENT', userId: DUENO, mensaje: 'x' }),
      esError(403)
    );
  });
});

describe('Alias me: el cliente empresa de la sesión (SCRUM-1387)', () => {
  let repository;
  let client;

  beforeEach(async () => {
    repository = new InMemoryCompanyClientRepository();
    const register = new RegisterCompanyClientWithSitesUseCase({
      companyClientRepository: repository,
      authIdentityService: { createUser: async () => ({ userId: DUENO }) },
    });
    ({ client } = await register.execute({
      tenantId: TENANT,
      razonSocial: 'Empresa Propia S.A.S.',
      nit: '900321654-7',
      email: 'propia@empresa.com',
      sitios: [{ nombre: 'Sede Única', direccion: 'Calle 26 # 68-40', zonaId: 'zona-1' }],
    }));
  });

  const sesion = { tenantId: TENANT, userId: DUENO, userRole: 'cliente' };

  it('lista, agrega y edita las sedes del cliente de la sesión sin conocer su id', async () => {
    const consultar = new GetCompanyClientSitesUseCase(repository);
    const agregar = new AddSiteToCompanyClientUseCase(repository);
    const editarSede = new UpdateCompanyClientSiteUseCase(repository);

    const nueva = await agregar.execute({ clienteId: 'me', ...sesion, direccion: 'Carrera 50 # 13-20', zonaId: 'zona-2' });
    assert.strictEqual(nueva.clienteId, client.id);

    await editarSede.execute({ clienteId: 'me', siteId: nueva.id, cambios: { nombre: 'Bodega' }, ...sesion });

    const { client: propio, sites } = await consultar.execute({ clienteId: 'me', ...sesion });
    assert.strictEqual(propio.id, client.id);
    assert.deepStrictEqual(
      sites.map((s) => s.nombre),
      ['Sede Única', 'Bodega']
    );
  });

  it('un usuario sin cliente empresa en el tenant recibe 404', async () => {
    await assert.rejects(
      new GetCompanyClientSitesUseCase(repository).execute({ clienteId: 'me', ...sesion, userId: 'otro-usuario' }),
      esError(404, 'CLIENT_NOT_FOUND')
    );
  });

  it('el mismo usuario en otro tenant no ve el cliente (404)', async () => {
    await assert.rejects(
      new GetCompanyClientSitesUseCase(repository).execute({ clienteId: 'me', ...sesion, tenantId: 'tenant-B' }),
      esError(404, 'CLIENT_NOT_FOUND')
    );
  });

  it('sin usuario en la sesión no consulta el repositorio y responde 404', async () => {
    let consultado = false;
    const repo = { findByUsuarioId: async () => (consultado = true), findById: async () => (consultado = true) };

    await assert.rejects(cargarCliente(repo, { clienteId: 'me', tenantId: TENANT }), esError(404, 'CLIENT_NOT_FOUND'));
    assert.strictEqual(consultado, false);
  });

  it('el admin del tenant no tiene cliente propio: con me recibe 404', async () => {
    await assert.rejects(
      new GetCompanyClientSitesUseCase(repository).execute({ clienteId: 'me', tenantId: TENANT, userId: 'admin-1', userRole: 'ADMIN' }),
      esError(404, 'CLIENT_NOT_FOUND')
    );
  });
});
