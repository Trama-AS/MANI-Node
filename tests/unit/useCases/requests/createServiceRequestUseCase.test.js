const test = require('node:test');
const assert = require('node:assert/strict');
const CreateServiceRequestUseCase = require('../../../../src/application/useCases/requests/CreateServiceRequestUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const ZONA = '44444444-4444-4444-8444-444444444444';
const SITIO = '55555555-5555-4555-8555-555555555555';
const CLAVE = '66666666-6666-4666-8666-666666666666';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const descripcion = 'Fuga de agua en el baño principal desde ayer';
const foto = (name = 'baño 1.png', mimetype = 'image/png') => ({ originalname: name, mimetype, buffer: Buffer.from('x') });

function setup({ resultado = { solicitud: { id: 'sol-1' }, creada: true }, falla = null } = {}) {
  const llamadas = [];
  const subidas = [];
  const borradas = [];
  const serviceRequestRepository = {
    crear: async (ctx, datos) => {
      llamadas.push({ ctx, datos });
      if (falla) throw falla;
      return resultado;
    },
  };
  const fileStorageService = {
    upload: async ({ path, bucket }) => { subidas.push({ path, bucket }); return { path: `${bucket}/${path}` }; },
    delete: async (path, { bucket }) => { borradas.push({ path, bucket }); },
  };
  return { useCase: new CreateServiceRequestUseCase({ serviceRequestRepository, fileStorageService }), llamadas, subidas, borradas };
}

test('con dirección nueva: valida, normaliza y pasa al repositorio el contexto del JWT', async () => {
  const { useCase, llamadas } = setup();

  const r = await useCase.execute({ user: cliente, body: { categoriaId: CAT, descripcion: `  ${descripcion}  `, direccion: ' Calle  1   # 2-3 ', zonaId: ZONA } });

  assert.equal(r.creada, true);
  assert.deepEqual(llamadas[0].ctx, { tenantId: TENANT, userId: USER, role: 'CLIENT' });
  assert.deepEqual(llamadas[0].datos, { categoriaId: CAT, descripcion, sitioId: null, direccion: 'Calle 1 # 2-3', zonaId: ZONA, fotos: [], claveIdempotencia: null });
});

test('con sitio existente no exige dirección ni zona', async () => {
  const { useCase, llamadas } = setup();

  await useCase.execute({ user: cliente, body: { categoriaId: CAT, descripcion, sitioId: SITIO, claveIdempotencia: CLAVE } });

  assert.equal(llamadas[0].datos.sitioId, SITIO);
  assert.equal(llamadas[0].datos.direccion, null);
  assert.equal(llamadas[0].datos.claveIdempotencia, CLAVE);
});

test('sube las fotos al bucket solicitudes bajo {tenant}/{usuario}/ y pasa esas rutas', async () => {
  const { useCase, llamadas, subidas, borradas } = setup();

  await useCase.execute({ user: cliente, body: { categoriaId: CAT, descripcion, sitioId: SITIO }, files: [foto(), foto('b.jpg', 'image/jpeg')] });

  assert.equal(subidas.length, 2);
  assert.ok(subidas.every((s) => s.bucket === 'solicitudes' && s.path.startsWith(`${TENANT}/${USER}/`)));
  assert.ok(subidas[0].path.endsWith('.png') && !/\s/.test(subidas[0].path));
  assert.deepEqual(llamadas[0].datos.fotos, subidas.map((s) => s.path));
  assert.equal(borradas.length, 0);
});

test('si la creación falla, borra las fotos subidas y propaga el error', async () => {
  const { useCase, subidas, borradas } = setup({ falla: new Error('fallo de base') });

  await assert.rejects(() => useCase.execute({ user: cliente, body: { categoriaId: CAT, descripcion, sitioId: SITIO }, files: [foto()] }), /fallo de base/);

  assert.deepEqual(borradas.map((b) => b.path), subidas.map((s) => s.path));
});

test('en un reintento con la misma clave (creada=false) descarta las fotos nuevas', async () => {
  const { useCase, borradas } = setup({ resultado: { solicitud: { id: 'sol-1' }, creada: false } });

  const r = await useCase.execute({ user: cliente, body: { categoriaId: CAT, descripcion, sitioId: SITIO, claveIdempotencia: CLAVE }, files: [foto()] });

  assert.equal(r.creada, false);
  assert.equal(borradas.length, 1);
});

for (const [name, body, files, codigo] of [
  ['sin categoría', { descripcion, sitioId: SITIO }, [], 'MANI-SOL-422C'],
  ['categoría que no es UUID', { categoriaId: 'x', descripcion, sitioId: SITIO }, [], 'MANI-SOL-422C'],
  ['descripción corta', { categoriaId: CAT, descripcion: 'corta', sitioId: SITIO }, [], 'MANI-SOL-422D'],
  ['descripción de más de 1000', { categoriaId: CAT, descripcion: 'x'.repeat(1001), sitioId: SITIO }, [], 'MANI-SOL-422D'],
  ['sin sitio ni dirección', { categoriaId: CAT, descripcion, zonaId: ZONA }, [], 'MANI-SOL-422S'],
  ['sitio que no es UUID', { categoriaId: CAT, descripcion, sitioId: 'x' }, [], 'MANI-SOL-422S'],
  ['dirección sin zona', { categoriaId: CAT, descripcion, direccion: 'Calle 1 # 2-3' }, [], 'MANI-SOL-422Z'],
  ['clave que no es UUID', { categoriaId: CAT, descripcion, sitioId: SITIO, claveIdempotencia: 'x' }, [], 'MANI-SOL-422K'],
  ['seis fotos', { categoriaId: CAT, descripcion, sitioId: SITIO }, Array.from({ length: 6 }, () => foto()), 'MANI-SOL-422F'],
  ['un PDF', { categoriaId: CAT, descripcion, sitioId: SITIO }, [foto('a.pdf', 'application/pdf')], 'MANI-SOL-422F'],
]) {
  test(`validación: ${name} responde 422 ${codigo} sin subir ni escribir`, async () => {
    const { useCase, llamadas, subidas } = setup();

    await assert.rejects(() => useCase.execute({ user: cliente, body, files }), (e) => e.statusCode === 422 && e.code === codigo);
    assert.equal(llamadas.length, 0);
    assert.equal(subidas.length, 0);
  });
}

test('un aliado o un admin no crean solicitudes (403); sin sesión o con usuario no UUID, 401', async () => {
  const { useCase } = setup();
  const body = { categoriaId: CAT, descripcion, sitioId: SITIO };

  await assert.rejects(() => useCase.execute({ user: { ...cliente, role: 'ALLY' }, body }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { ...cliente, role: 'ADMIN' }, body }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: null, body }), (e) => e.statusCode === 401);
  await assert.rejects(() => useCase.execute({ user: { ...cliente, userId: 'demo' }, body }), (e) => e.statusCode === 401);
});

test('exige sus dependencias', () => {
  assert.throws(() => new CreateServiceRequestUseCase({}), /serviceRequestRepository/);
  assert.throws(() => new CreateServiceRequestUseCase({ serviceRequestRepository: {} }), /fileStorageService/);
});
