const test = require('node:test');
const assert = require('node:assert/strict');
const UpdateOwnProfileUseCase = require('../../../../src/application/useCases/profiles/UpdateOwnProfileUseCase');
const InMemoryProfileRepository = require('../../../../src/infrastructure/repositories/InMemoryProfileRepository');
const InMemoryFileStorageService = require('../../../../src/infrastructure/security/InMemoryFileStorageService');

function makeUseCase() {
  const profileRepository = new InMemoryProfileRepository();
  const fileStorageService = new InMemoryFileStorageService();
  const useCase = new UpdateOwnProfileUseCase({ profileRepository, fileStorageService });
  return { useCase, profileRepository, fileStorageService };
}

test('SCRUM-1027: actualiza datos personales, teléfono, dirección y foto del usuario autenticado', async () => {
  const { useCase } = makeUseCase();

  const updated = await useCase.execute({
    userId: 'demo-user-1',
    tenantId: 'trama-demo',
    payload: {
      fullName: 'Usuario Demo Actualizado',
      phone: '+57 300 456 7890',
      address: 'Calle 100 # 15-20 Apto 401',
    },
    photoFile: {
      originalname: 'foto.png',
      mimetype: 'image/png',
      buffer: Buffer.from('png-bytes'),
    },
  });

  assert.equal(updated.id, 'demo-user-1');
  assert.equal(updated.fullName, 'Usuario Demo Actualizado');
  assert.equal(updated.phone, '+57 300 456 7890');
  assert.equal(updated.address, 'Calle 100 # 15-20 Apto 401');
  assert.match(updated.photoUrl, /^trama-demo\/demo-user-1\/avatar-/);
});

test('SCRUM-854: rechaza con 403 MANI-PRF-403 cuando intenta editar el perfil de otro usuario', async () => {
  const { useCase } = makeUseCase();

  await assert.rejects(
    () =>
      useCase.execute({
        userId: 'demo-user-1',
        tenantId: 'trama-demo',
        targetUserId: 'demo-ally-1',
        payload: { fullName: 'Intento Suplantacion' },
      }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'MANI-PRF-403');
      return true;
    }
  );
});

for (const privilegedField of ['role', 'status', 'tenantId', 'id', 'email']) {
  test(`SCRUM-854: rechaza con 403 MANI-PRF-403 cambios en campo privilegiado "${privilegedField}"`, async () => {
    const { useCase } = makeUseCase();

    await assert.rejects(
      () =>
        useCase.execute({
          userId: 'demo-user-1',
          tenantId: 'trama-demo',
          payload: {
            fullName: 'Nombre Valido',
            [privilegedField]: 'VALOR_NO_PERMITIDO',
          },
        }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'MANI-PRF-403');
        return true;
      }
    );
  });
}

test('SCRUM-1028: valida formato de teléfono, dirección no vacía y formato de imagen soportado', async () => {
  const { useCase } = makeUseCase();

  await assert.rejects(
    () =>
      useCase.execute({
        userId: 'demo-user-1',
        tenantId: 'trama-demo',
        payload: { phone: 'abc-invalido' },
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'MANI-PRF-422');
      return true;
    }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        userId: 'demo-user-1',
        tenantId: 'trama-demo',
        payload: { address: '   ' },
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'MANI-PRF-422');
      return true;
    }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        userId: 'demo-user-1',
        tenantId: 'trama-demo',
        photoFile: {
          originalname: 'script.exe',
          mimetype: 'application/x-msdownload',
          buffer: Buffer.from('exe'),
        },
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'MANI-PRF-422F');
      return true;
    }
  );
});

test('UpdateOwnProfileUseCase: rechaza una URL de foto en el cuerpo sin tocar el repositorio (SCRUM-854)', async () => {
  let called = false;
  const useCase = new UpdateOwnProfileUseCase({
    profileRepository: { updateOwnProfile: async () => { called = true; return null; } },
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', payload: { photoUrl: 'https://evil.example/x.png' } }),
    (err) => err.code === 'MANI-PRF-422'
  );
  assert.equal(called, false);
});

// SCRUM-1628: la foto es JPG o PNG de hasta 5 MB; WEBP y otros formatos se rechazan con código propio y sin tocar el perfil.
test('SCRUM-1628 C2: WEBP y otros formatos se rechazan con MANI-PRF-422F y el mensaje del límite', async () => {
  for (const mimetype of ['image/webp', 'image/gif', 'application/pdf', '']) {
    const { useCase } = makeUseCase();
    await assert.rejects(
      () =>
        useCase.execute({
          userId: 'demo-user-1',
          tenantId: 'trama-demo',
          photoFile: { originalname: 'a.webp', mimetype, buffer: Buffer.from('x') },
        }),
      (err) => {
        assert.equal(err.code, 'MANI-PRF-422F', mimetype);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, 'La foto debe ser JPG o PNG de hasta 5 MB');
        return true;
      }
    );
  }
});

test('SCRUM-1628 C3: una foto de más de 5 MB se rechaza con MANI-PRF-413 y no cambia el perfil; 5 MB exactos pasan', async () => {
  let escrituras = 0;
  const base = makeUseCase().useCase;
  const useCase = new UpdateOwnProfileUseCase({
    profileRepository: {
      ...base.profileRepository,
      updateOwnProfile: async (...args) => {
        escrituras += 1;
        return base.profileRepository.updateOwnProfile(...args);
      },
    },
    fileStorageService: base.fileStorageService,
  });
  const MB5 = 5 * 1024 * 1024;

  await assert.rejects(
    () =>
      useCase.execute({
        userId: 'demo-user-1',
        tenantId: 'trama-demo',
        photoFile: { originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.alloc(MB5 + 1, 1) },
      }),
    (err) => {
      assert.equal(err.code, 'MANI-PRF-413');
      assert.equal(err.statusCode, 413);
      assert.equal(err.message, 'La foto debe ser JPG o PNG de hasta 5 MB');
      return true;
    }
  );
  assert.equal(escrituras, 0);

  for (const mimetype of ['image/png', 'image/jpeg']) {
    const ok = await useCase.execute({
      userId: 'demo-user-1',
      tenantId: 'trama-demo',
      photoFile: { originalname: 'a.png', mimetype, buffer: Buffer.alloc(MB5, 1) },
    });
    assert.match(ok.photoUrl, /^trama-demo\/demo-user-1\/avatar-/, mimetype);
  }
});
