// El dominio habla en inglés (ALLY, CLIENT, ADMIN). El claim `user_role`/`rol`
// del JWT real de Supabase lo emite en español minúscula el Custom Access
// Token Hook (CFG-12, database/migrations/007_normalizar_dominios.sql):
// `lower(u.rol)` sobre valores 'ALIADO' | 'CLIENTE' | 'ADMIN_TENANT'.
// PLATFORM_ADMIN es el único permiso para operar sobre todos los tenants (SCRUM-1364); ningún rol de tenant lo incluye.
const DOMAIN_TO_CLAIM_ROLE = { ALLY: 'aliado', CLIENT: 'cliente', ADMIN: 'admin_tenant', PLATFORM_ADMIN: 'admin_plataforma' };
const CLAIM_ROLE_TO_DOMAIN = { aliado: 'ALLY', cliente: 'CLIENT', admin_tenant: 'ADMIN', admin_plataforma: 'PLATFORM_ADMIN' };

function domainRoleToClaim(domainRole) {
  return DOMAIN_TO_CLAIM_ROLE[domainRole] || domainRole.toLowerCase();
}

function claimRoleToDomain(claimRole) {
  if (!claimRole) return undefined;
  return CLAIM_ROLE_TO_DOMAIN[claimRole.toLowerCase()] || claimRole.toUpperCase();
}

module.exports = { domainRoleToClaim, claimRoleToDomain };
