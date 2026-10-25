const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterClientCompanyUseCase = require('../../../../src/application/useCases/auth/RegisterClientCompanyUseCase');
const { normalizeNit } = require('../../../../src/application/useCases/auth/RegisterClientCompanyUseCase');

const VALID_INPUT = {
  tenantSlug: 'trama-demo',
  razonSocial: 'Constructora Andina SAS',
  nit: '900.123.456-7',
  nombreRepresentante: 'Laura Gomez',
  email: 'compras@andina.test',
  password: 'Cambiar123!',
  phone: '+576011234567',
  acceptsTerms: true,
};

function makeUseCase({ existingNit = null, existingEmail = null, failAt = null } = {}) {
  const log = [];
  const fail = (step) => {
    if (failAt === step) throw new Error(`falla en ${step}`);
  };
  const deps = {
    tenantRepository: {
      findBySlug: async (slug) =>
        slug === 'trama-demo' ? { id: 'tenant-1', isActive: () => true } : slug === 'inactivo' ? { id: 't2', isActive: () => false } : null,
    },
    usuarioRepository: {
      findByEmail: async () => existingEmail,
      create: async (u) => { log.push(['usuario.create', u]); fail('usuario'); return u; },
      deleteById: async (...a) => log.push(['usuario.delete', ...a]),
    },
    clienteRepository: {
      findByNit: async (...a) => { log.push(['cliente.findByNit', ...a]); return existingNit; },
      create: async (c) => { log.push(['cliente.create', c]); fail('cliente'); return { id: 'cliente-1', ...c }; },
      deleteByUsuarioId: async (...a) => log.push(['cliente.delete', ...a]),
    },
    authIdentityService: {
      createUser: async (u) => { log.push(['auth.create', u]); return { userId: 'user-1' }; },
      authenticate: async () => { fail('authenticate'); return { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }; },
      deleteUser: async (id) => log.push(['auth.delete', id]),
    },
    registerUserConsentUseCase: { execute: async (c) => { log.push(['consent.create', c]); fail('consent'); } },
    userConsentRepository: { deleteByUsuarioId: async (...a) => log.push(['consent.delete', ...a]) },
  };
  return { useCase: new RegisterClientCompanyUseCase(deps), log };
}

const steps = (log) => log.map(([step]) => step);

test('registra la empresa como cliente PERSONA_JURIDICA con NIT normalizado y representante, sin sitios', async () => {
  const { useCase, log } = makeUseCase();

  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.profile.role, 'CLIENT');
  assert.equal(result.profile.status, 'VERIFIED');
  assert.equal(result.profile.fullName, 'Constructora Andina SAS');
  assert.equal(result.profile.tenantId, 'tenant-1');
  assert.deepEqual(result.company, {
    clienteId: 'cliente-1',
    tipo: 'PERSONA_JURIDICA',
    razonSocial: 'Constructora Andina SAS',
    nit: '900123456-7',
    nombreRepresentante: 'Laura Gomez',
  });
  assert.deepEqual(result.tokens, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });

  const cliente = log.find(([s]) => s === 'cliente.create')[1];
  assert.deepEqual(cliente, {
    tenantId: 'tenant-1',
    usuarioId: 'user-1',
    tipo: 'PERSONA_JURIDICA',
    razonSocial: 'Constructora Andina SAS',
    nit: '900123456-7',
    telefono: '+576011234567',
    nombreRepresentante: 'Laura Gomez',
  });
  assert.deepEqual(log.find(([s]) => s === 'auth.create')[1].role, 'CLIENT');
  assert.deepEqual(steps(log), ['cliente.findByNit', 'auth.create', 'usuario.create', 'cliente.create', 'consent.create']);
});

test('registra el consentimiento de términos con IP y user agent', async () => {
  const { useCase, log } = makeUseCase();
  await useCase.execute({ ...VALID_INPUT, ipAddress: '10.0.0.1', userAgent: 'flutter' });
  assert.deepEqual(log.find(([s]) => s === 'consent.create')[1], {
    tenantId: 'tenant-1', usuarioId: 'user-1', ipAddress: '10.0.0.1', userAgent: 'flutter',
  });
});

test('sin aceptar términos responde TERMS_NOT_ACCEPTED y no crea nada', async () => {
  for (const acceptsTerms of [undefined, false, 'false']) {
    const { useCase, log } = makeUseCase();
    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, acceptsTerms }), (err) => err.code === 'TERMS_NOT_ACCEPTED' && err.statusCode === 400);
    assert.deepEqual(log, []);
  }
});

for (const field of ['tenantSlug', 'razonSocial', 'nit', 'nombreRepresentante', 'email', 'password']) {
  test(`VALIDATION_ERROR cuando falta ${field}`, async () => {
    const { useCase, log } = makeUseCase();
    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, [field]: undefined }), (err) => err.code === 'VALIDATION_ERROR' && err.statusCode === 400);
    assert.deepEqual(log, []);
  });
}

test('rechaza NIT con formato inválido', async () => {
  for (const nit of ['12345', '90012345A', '900123456-78', '   ']) {
    const { useCase } = makeUseCase();
    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, nit }), (err) => err.code === 'VALIDATION_ERROR' && /nit/.test(err.message));
  }
});

test('rechaza email inválido y contraseña corta', async () => {
  const { useCase } = makeUseCase();
  await assert.rejects(() => useCase.execute({ ...VALID_INPUT, email: 'no-es-email' }), (err) => err.code === 'VALIDATION_ERROR');
  await assert.rejects(() => useCase.execute({ ...VALID_INPUT, password: 'corta' }), (err) => err.code === 'VALIDATION_ERROR');
});

test('tenant inexistente o inactivo responde TENANT_NOT_FOUND', async () => {
  const { useCase } = makeUseCase();
  for (const tenantSlug of ['no-existe', 'inactivo']) {
    await assert.rejects(() => useCase.execute({ ...VALID_INPUT, tenantSlug }), (err) => err.code === 'TENANT_NOT_FOUND');
  }
});

test('email ya registrado en el tenant responde 409 y no crea identidad', async () => {
  const { useCase, log } = makeUseCase({ existingEmail: { id: 'u0' } });
  await assert.rejects(() => useCase.execute(VALID_INPUT), (err) => err.code === 'EMAIL_ALREADY_REGISTERED' && err.statusCode === 409);
  assert.equal(log.some(([s]) => s === 'auth.create'), false);
});

test('NIT ya registrado en el tenant responde 409 COMPANY_ALREADY_REGISTERED y no crea identidad', async () => {
  const { useCase, log } = makeUseCase({ existingNit: { id: 'c0' } });
  await assert.rejects(() => useCase.execute(VALID_INPUT), (err) => err.code === 'COMPANY_ALREADY_REGISTERED' && err.statusCode === 409);
  assert.deepEqual(log[0], ['cliente.findByNit', 'tenant-1', '900123456-7']);
  assert.equal(log.some(([s]) => s === 'auth.create'), false);
});

test('si falla la autenticación compensa consentimiento, cliente, usuario e identidad', async () => {
  const { useCase, log } = makeUseCase({ failAt: 'authenticate' });
  await assert.rejects(() => useCase.execute(VALID_INPUT), /falla en authenticate/);
  assert.deepEqual(steps(log).slice(-4), ['consent.delete', 'cliente.delete', 'usuario.delete', 'auth.delete']);
});

test('si falla el cliente no intenta borrar lo que no se creó', async () => {
  const { useCase, log } = makeUseCase({ failAt: 'cliente' });
  await assert.rejects(() => useCase.execute(VALID_INPUT), /falla en cliente/);
  assert.deepEqual(steps(log).slice(-2), ['usuario.delete', 'auth.delete']);
  assert.equal(log.some(([s]) => s === 'cliente.delete' || s === 'consent.delete'), false);
});

test('normalizeNit quita puntos y espacios', () => {
  assert.equal(normalizeNit(' 900.123.456 - 7 '), '900123456-7');
  assert.equal(normalizeNit(undefined), undefined);
});
