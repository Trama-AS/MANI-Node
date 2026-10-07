const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterClientNaturalPersonUseCase = require('../../../../src/application/useCases/auth/RegisterClientNaturalPersonUseCase');

const VALID_INPUT = {
  tenantSlug: 'trama-demo',
  fullName: 'Maria Fernanda Rojas',
  email: 'cliente@mani.test',
  password: 'Cambiar123!',
  phone: '+573001234567',
};

function makeUseCase(overrides = {}) {
  const tenantRepository = {
    findBySlug: async (slug) => ({ id: 'trama-demo', slug: slug || 'trama-demo', name: 'Demo', status: 'ACTIVE', isActive: () => true }),
  };
  const usuarioRepository = { findByEmail: async () => null, create: async (u) => u, deleteById: async () => {} };
  const clienteRepository = {
    create: async (c) => ({ id: 'cliente-1', ...c }),
    deleteByUsuarioId: async () => {},
  };
  const sitioRepository = {
    findFirstActiveZonaId: async () => 'zona-1',
    create: async (s) => s,
    deleteByClienteId: async () => {},
  };
  const authIdentityService = {
    createUser: async () => ({ userId: 'user-1' }),
    authenticate: async () => ({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
    deleteUser: async () => {},
  };

  return new RegisterClientNaturalPersonUseCase({
    tenantRepository,
    usuarioRepository,
    clienteRepository,
    sitioRepository,
    authIdentityService,
    ...overrides,
  });
}

test('registra un cliente y retorna profile CLIENT/VERIFIED + tokens', async () => {
  const useCase = makeUseCase();

  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.profile.role, 'CLIENT');
  assert.equal(result.profile.status, 'VERIFIED');
  assert.equal(result.profile.tenantId, 'trama-demo');
  assert.equal(result.profile.fullName, VALID_INPUT.fullName);
  assert.deepEqual(result.tokens, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
});

for (const field of ['fullName', 'email', 'password']) {
  test(`VALIDATION_ERROR cuando falta ${field}`, async () => {
    const useCase = makeUseCase();
    const input = { ...VALID_INPUT, [field]: undefined };

    await assert.rejects(
      () => useCase.execute(input),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
}

test('VALIDATION_ERROR cuando falta tenantSlug (header X-Tenant-Slug)', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, tenantSlug: undefined }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando el email tiene formato inválido', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, email: 'no-es-un-email' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando el password tiene menos de 8 caracteres', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, password: 'short' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('TENANT_NOT_FOUND cuando el tenant no existe', async () => {
  const useCase = makeUseCase({ tenantRepository: { findBySlug: async () => null } });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('TENANT_NOT_FOUND cuando el tenant está inactivo', async () => {
  const useCase = makeUseCase({
    tenantRepository: {
      findBySlug: async () => ({ id: 'trama-demo', name: 'Demo', status: 'INACTIVE', isActive: () => false }),
    },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      return true;
    }
  );
});

test('EMAIL_ALREADY_REGISTERED (CA-4) cuando el email ya existe en el tenant, y no crea una segunda cuenta', async () => {
  let identityCreated = false;
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => ({ id: 'otro-user' }), create: async (u) => u },
    authIdentityService: {
      createUser: async () => {
        identityCreated = true;
        return { userId: 'x' };
      },
      authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
      deleteUser: async () => {},
    },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'EMAIL_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
  assert.equal(identityCreated, false); // no se llega a crear identidad en Auth
});

test('authenticate() se llama después de crear usuario/cliente (orden correcto para el hook de claims)', async () => {
  const calls = [];
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => null, create: async (u) => { calls.push('usuario'); return u; } },
    clienteRepository: { create: async (c) => { calls.push('cliente'); return c; }, deleteByUsuarioId: async () => {} },
    authIdentityService: {
      createUser: async () => { calls.push('createUser'); return { userId: 'user-1' }; },
      authenticate: async () => { calls.push('authenticate'); return { accessToken: 'a', refreshToken: 'b', expiresIn: 1 }; },
      deleteUser: async () => {},
    },
  });

  await useCase.execute(VALID_INPUT);

  assert.deepEqual(calls, ['createUser', 'usuario', 'cliente', 'authenticate']);
});

// B3: mismo patrón de compensación que el registro de Aliado.
test('B3: si falla crear el cliente, compensa (borra) usuario+identidad y relanza el error original', async () => {
  const calls = [];
  const originalError = new Error('DB caída');

  const useCase = makeUseCase({
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => { calls.push('usuario.create'); return u; },
      deleteById: async () => { calls.push('usuario.deleteById'); },
    },
    clienteRepository: {
      create: async () => { calls.push('cliente.create'); throw originalError; },
      deleteByUsuarioId: async () => { calls.push('cliente.deleteByUsuarioId'); },
    },
    authIdentityService: {
      createUser: async () => { calls.push('auth.createUser'); return { userId: 'user-1' }; },
      authenticate: async () => { calls.push('auth.authenticate'); return { accessToken: 'a', refreshToken: 'b', expiresIn: 1 }; },
      deleteUser: async () => { calls.push('auth.deleteUser'); },
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT), (err) => err === originalError);

  assert.ok(!calls.includes('auth.authenticate'));
  assert.ok(!calls.includes('cliente.deleteByUsuarioId')); // cliente nunca llegó a crearse
  assert.ok(calls.includes('usuario.deleteById'));
  assert.ok(calls.includes('auth.deleteUser'));
});

test('B3: tras una falla compensada, un reintento con los mismos datos se registra limpio (sin 409 falso)', async () => {
  const InMemoryUsuarioRepository = require('../../../../src/infrastructure/repositories/InMemoryUsuarioRepository');
  const InMemoryClienteRepository = require('../../../../src/infrastructure/repositories/InMemoryClienteRepository');

  const usuarioRepository = new InMemoryUsuarioRepository();
  const clienteRepository = new InMemoryClienteRepository();
  const identities = new Map();

  let failCreateCliente = true;
  const originalClienteCreate = clienteRepository.create.bind(clienteRepository);
  clienteRepository.create = async (data) => {
    if (failCreateCliente) throw new Error('Cliente: fallo transitorio (primer intento)');
    return originalClienteCreate(data);
  };

  const authIdentityService = {
    createUser: async ({ email }) => {
      const userId = `user-${identities.size + 1}`;
      identities.set(userId, { email });
      return { userId };
    },
    authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
    deleteUser: async (userId) => { identities.delete(userId); },
  };

  const useCase = makeUseCase({ usuarioRepository, clienteRepository, authIdentityService });

  await assert.rejects(() => useCase.execute(VALID_INPUT));

  assert.equal(await usuarioRepository.findByEmail('trama-demo', VALID_INPUT.email), null);
  assert.equal(identities.size, 0);

  failCreateCliente = false;
  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.profile.role, 'CLIENT');
  assert.equal(result.profile.status, 'VERIFIED');
});

// --- sitio/direccionHogar (US-02.2.1-M2.2) ---

test('con direccionHogar, crea el sitio (hogar) con la zona activa y las reglas de contacto', async () => {
  const calls = [];
  const useCase = makeUseCase({
    clienteRepository: {
      create: async (c) => { calls.push('cliente.create'); return { id: 'cliente-1', ...c }; },
      deleteByUsuarioId: async () => {},
    },
    sitioRepository: {
      findFirstActiveZonaId: async () => { calls.push('findFirstActiveZonaId'); return 'zona-1'; },
      create: async (s) => { calls.push('sitio.create'); return { id: 'sitio-1', ...s }; },
      deleteByClienteId: async () => {},
    },
  });

  await useCase.execute({ ...VALID_INPUT, direccionHogar: '  Calle 1 # 2-3  ' });

  assert.deepEqual(calls, ['cliente.create', 'findFirstActiveZonaId', 'sitio.create']);
});

test('el sitio creado usa clienteId, zonaId, dirección recortada y reglas con nombre_contacto/telefono', async () => {
  let sitioCreado;
  const useCase = makeUseCase({
    sitioRepository: {
      findFirstActiveZonaId: async () => 'zona-1',
      create: async (s) => {
        sitioCreado = s;
        return { id: 'sitio-1', ...s };
      },
      deleteByClienteId: async () => {},
    },
  });

  await useCase.execute({ ...VALID_INPUT, direccionHogar: '  Calle 1 # 2-3  ' });

  assert.equal(sitioCreado.tenantId, 'trama-demo');
  assert.equal(sitioCreado.clienteId, 'cliente-1');
  assert.equal(sitioCreado.zonaId, 'zona-1');
  assert.equal(sitioCreado.direccion, 'Calle 1 # 2-3');
  assert.deepEqual(sitioCreado.reglas, { nombre_contacto: VALID_INPUT.fullName, telefono: VALID_INPUT.phone });
});

test('sin direccionHogar (o vacía/solo espacios), no se busca zona ni se crea sitio', async () => {
  const calls = [];
  const sitioRepository = {
    findFirstActiveZonaId: async () => { calls.push('findFirstActiveZonaId'); return 'zona-1'; },
    create: async (s) => { calls.push('sitio.create'); return s; },
    deleteByClienteId: async () => {},
  };

  await makeUseCase({ sitioRepository }).execute(VALID_INPUT);
  await makeUseCase({ sitioRepository }).execute({ ...VALID_INPUT, direccionHogar: '   ' });

  assert.deepEqual(calls, []);
});

test('si no hay ninguna zona activa, el registro no falla y simplemente no crea el sitio', async () => {
  const calls = [];
  const useCase = makeUseCase({
    sitioRepository: {
      findFirstActiveZonaId: async () => null,
      create: async (s) => { calls.push('sitio.create'); return s; },
      deleteByClienteId: async () => {},
    },
  });

  const result = await useCase.execute({ ...VALID_INPUT, direccionHogar: 'Calle 1' });

  assert.equal(result.profile.role, 'CLIENT');
  assert.deepEqual(calls, []);
});

test('B3: si falla crear el sitio, compensa (borra) sitio+cliente+usuario+identidad y relanza el error original', async () => {
  const calls = [];
  const originalError = new Error('Storage de sitios caído');

  const useCase = makeUseCase({
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => { calls.push('usuario.create'); return u; },
      deleteById: async () => { calls.push('usuario.deleteById'); },
    },
    clienteRepository: {
      create: async (c) => { calls.push('cliente.create'); return { id: 'cliente-1', ...c }; },
      deleteByUsuarioId: async () => { calls.push('cliente.deleteByUsuarioId'); },
    },
    sitioRepository: {
      findFirstActiveZonaId: async () => 'zona-1',
      create: async () => { calls.push('sitio.create'); throw originalError; },
      deleteByClienteId: async () => { calls.push('sitio.deleteByClienteId'); },
    },
    authIdentityService: {
      createUser: async () => { calls.push('auth.createUser'); return { userId: 'user-1' }; },
      authenticate: async () => { calls.push('auth.authenticate'); return { accessToken: 'a', refreshToken: 'b', expiresIn: 1 }; },
      deleteUser: async () => { calls.push('auth.deleteUser'); },
    },
  });

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, direccionHogar: 'Calle 1' }),
    (err) => err === originalError
  );

  assert.ok(!calls.includes('auth.authenticate'));
  // El sitio nunca llegó a crearse (create() lanzó), así que no debe compensarse.
  assert.ok(!calls.includes('sitio.deleteByClienteId'));
  assert.ok(calls.includes('cliente.deleteByUsuarioId'));
  assert.ok(calls.includes('usuario.deleteById'));
  assert.ok(calls.includes('auth.deleteUser'));
});
