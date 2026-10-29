const { Router } = require('express');
const tenantsController = require('../../controllers/tenants.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// Dominio Tenants (organizaciones).
const router = Router();

// SCRUM-1364: el listado global de tenants es de la administración de plataforma. Antes no pedía sesión y cualquiera
// podía enumerar todas las empresas; ahora exige autenticación y el permiso explícito PLATFORM_ADMIN, que ningún rol
// de tenant (ni siquiera admin_tenant) incluye. Cada persona ve el nombre de su propio tenant en GET /profiles/me.
router.get('/tenants', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.listTenants);

module.exports = router;
