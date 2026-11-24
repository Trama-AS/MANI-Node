// SCRUM-1634: la base guarda la ruta de la foto en Storage, pero GET/PATCH /profiles/me y POST /profiles/me/photo
// devuelven una URL firmada que la app puede abrir. Si la firma falla, el perfil sale sin foto, nunca con 500.
const test = require('node:test');
const assert = require('node:assert/strict');

const { conFotoFirmada, SEGUNDOS_URL_FOTO } = require('../../../../src/application/useCases/profiles/fotoPerfilFirmada');
const GetOwnProfileUseCase = require('../../../../src/application/useCases/profiles/GetOwnProfileUseCase');
const UpdateOwnProfileUseCase = require('../../../../src/application/useCases/profiles/UpdateOwnProfileUseCase');
const InMemoryProfileRepository = require('../../../../src/infrastructure/repositories/InMemoryProfileRepository');
const InMemoryFileStorageService = require('../../../../src/infrastructure/security/InMemoryFileStorageService');

const RUTA = 'kyc-documentos/trama-demo/demo-user-1/avatar-1-foto.jpg';

function storageQueFirma() {
  const llamadas = [];
  return {
    llamadas,
    async createSignedUrl(ruta, segundos) {
      llamadas.push({ ruta, segundos });
      return { signedUrl: `https://storage.example/firmada?ruta=${encodeURIComponent(ruta)}`, expiresIn: segundos };
    },
  };
}

const storageQueFalla = {
  async createSignedUrl() {
    throw new Error('Storage caído');
  },
};

test('SCRUM-1634: una ruta de Storage se devuelve como URL firmada de una hora', async () => {
  const storage = storageQueFirma();
  const perfil = await conFotoFirmada({ userId: 'u1', photoUrl: RUTA, fullName: 'Ana' }, storage);

  assert.match(perfil.photoUrl, /^https:\/\/storage\.example\/firmada/);
  assert.equal(perfil.fullName, 'Ana');
  assert.deepEqual(storage.llamadas, [{ ruta: RUTA, segundos: SEGUNDOS_URL_FOTO }]);
  assert.equal(SEGUNDOS_URL_FOTO, 3600);
});

test('SCRUM-1634: no modifica el objeto que recibe (el repositorio sigue con la ruta)', async () => {
  const original = { userId: 'u1', photoUrl: RUTA };
  await conFotoFirmada(original, storageQueFirma());
  assert.equal(original.photoUrl, RUTA);
});

test('SCRUM-1634: si la firma falla, el perfil sale sin foto y no lanza', async () => {
  const perfil = await conFotoFirmada({ userId: 'u1', photoUrl: RUTA, fullName: 'Ana' }, storageQueFalla);
  assert.equal(Object.hasOwn(perfil, 'photoUrl'), false);
  assert.equal(perfil.fullName, 'Ana');
});

test('SCRUM-1634: sin servicio de Storage tampoco se expone la ruta interna', async () => {
  const perfil = await conFotoFirmada({ userId: 'u1', photoUrl: RUTA }, null);
  assert.equal(Object.hasOwn(perfil, 'photoUrl'), false);
});

test('SCRUM-1634: sin foto o con una URL absoluta, el perfil sale igual y no se firma nada', async () => {
  const storage = storageQueFirma();
  const sinFoto = { userId: 'u1', fullName: 'Ana' };
  assert.equal(await conFotoFirmada(sinFoto, storage), sinFoto);
  const vacia = { userId: 'u1', photoUrl: '  ' };
  assert.equal(await conFotoFirmada(vacia, storage), vacia);
  const absoluta = { userId: 'u1', photoUrl: 'https://cdn.example/a.png' };
  assert.equal(await conFotoFirmada(absoluta, storage), absoluta);
  assert.equal(await conFotoFirmada(null, storage), null);
  assert.equal(storage.llamadas.length, 0);
});

test('SCRUM-1634: GET /profiles/me devuelve la foto firmada y, si la firma falla, el perfil sin foto', async () => {
  const profileRepository = new InMemoryProfileRepository();
  await profileRepository.updateOwnProfile('demo-user-1', 'trama-demo', { photoUrl: RUTA });

  const conFirma = new GetOwnProfileUseCase({ profileRepository, fileStorageService: new InMemoryFileStorageService() });
  const perfil = await conFirma.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' });
  assert.match(perfil.photoUrl, /^https:\/\/storage\.mani\.local\/kyc-documentos\/trama-demo\/demo-user-1\/avatar-1-foto\.jpg\?token=/);

  const sinFirma = new GetOwnProfileUseCase({ profileRepository, fileStorageService: storageQueFalla });
  const sinFoto = await sinFirma.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' });
  assert.equal(Object.hasOwn(sinFoto, 'photoUrl'), false);
  assert.equal(sinFoto.id, 'demo-user-1');
});

test('SCRUM-1634: al subir la foto se guarda la ruta y se responde la URL firmada', async () => {
  const profileRepository = new InMemoryProfileRepository();
  const useCase = new UpdateOwnProfileUseCase({ profileRepository, fileStorageService: new InMemoryFileStorageService() });

  const respuesta = await useCase.execute({
    userId: 'demo-user-1',
    tenantId: 'trama-demo',
    photoFile: { originalname: 'foto.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('jpg-bytes') },
  });

  assert.match(respuesta.photoUrl, /^https:\/\/storage\.mani\.local\/.+\?token=/);
  const guardado = await profileRepository.findByUserId('demo-user-1', 'trama-demo');
  assert.match(guardado.photoUrl, /^trama-demo\/demo-user-1\/avatar-\d+-foto\.jpg$/, 'la base guarda la ruta, no la URL');
});
