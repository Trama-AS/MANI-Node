const container = require('../container');

async function findByUserId(userId, tenantId = null) {
  const profile = await container.profileRepository.findByUserId(userId, tenantId);
  return typeof profile.toJSON === 'function' ? profile.toJSON() : profile;
}

module.exports = { findByUserId };

