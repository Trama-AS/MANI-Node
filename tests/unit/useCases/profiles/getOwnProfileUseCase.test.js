const test = require('node:test');
const assert = require('node:assert/strict');
const GetOwnProfileUseCase = require('../../../../src/application/useCases/profiles/GetOwnProfileUseCase');
const InMemoryProfileRepository = require('../../../../src/infrastructure/repositories/InMemoryProfileRepository');
const InMemoryTenantRepository = require('../../../../src/infrastructure/repositories/InMemoryTenantRepository');
const { claimRoleToDomain, domainRoleToClaim } = require('../../../../src/infrastructure/security/claimRoleMap');

test('SCRUM-1364: el perfil incluye el nombre del tenant de la sesión', async () => {
  const useCase = new GetOwnProfileUseCase({
    profileRepository: new InMemoryProfileRepository(),
    tenantRepository: new InMemoryTenantRepository(),
  });

  const profile = await useCase.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' });

  assert.equal(profile.tenantId, 'trama-demo');
  assert.equal(profile.tenantName, 'TRAMA Servicios Demo');
});

test('SCRUM-1364: pide solo el tenant del propio perfil, nunca el listado', async () => {
  const calls = [];
  const tenantRepository = {
    findById: async (id) => (calls.push(['findById', id]), { name: 'Mi empresa' }),
    findAll: async () => {
      calls.push(['findAll']);
      return [];
    },
  };
  const useCase = new GetOwnProfileUseCase({ profileRepository: new InMemoryProfileRepository(), tenantRepository });

  await useCase.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' });

  assert.deepEqual(calls, [['findById', 'trama-demo']]);
});

test('SCRUM-1364: sin el repositorio de tenants, o si el tenant no existe, el perfil sale sin tenantName', async () => {
  const sinRepo = new GetOwnProfileUseCase({ profileRepository: new InMemoryProfileRepository() });
  assert.equal((await sinRepo.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' })).tenantName, undefined);

  const sinTenant = new GetOwnProfileUseCase({
    profileRepository: new InMemoryProfileRepository(),
    tenantRepository: { findById: async () => null },
  });
  assert.equal((await sinTenant.execute({ userId: 'demo-user-1', tenantId: 'trama-demo' })).tenantName, undefined);
});

test('SCRUM-1364: el permiso de plataforma es un claim propio y no lo comparte ningún rol de tenant', () => {
  assert.equal(claimRoleToDomain('admin_plataforma'), 'PLATFORM_ADMIN');
  assert.equal(domainRoleToClaim('PLATFORM_ADMIN'), 'admin_plataforma');
  for (const claim of ['cliente', 'aliado', 'admin_tenant']) {
    assert.notEqual(claimRoleToDomain(claim), 'PLATFORM_ADMIN');
  }
});
