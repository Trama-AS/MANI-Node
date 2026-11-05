const { Router } = require('express');
const tenantsController = require('../../controllers/tenants.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// Dominio Tenants (organizaciones).
const router = Router();

// SCRUM-1364: el listado global de tenants es de la administración de plataforma. Antes no pedía sesión y cualquiera
// podía enumerar todas las empresas; ahora exige autenticación y el permiso explícito PLATFORM_ADMIN, que ningún rol
// de tenant (ni siquiera admin_tenant) incluye. Cada persona ve el nombre de su propio tenant en GET /profiles/me.
router.get('/tenants', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.listTenants);
// SCRUM-901: habilitar, suspender o inactivar un tenant, con motivo y registro del cambio. Mismo permiso explícito.
router.patch('/tenants/:id/estado', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.changeTenantStatus);
router.get('/tenants/:id/estado/historial', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.getTenantStatusHistory);
// SCRUM-901: usuarios de un tenant, para que el administrador de plataforma elija con quién actuar.
// SCRUM-901: contexto efectivo de la sesión (tenant, usuario y rol con los que se atiende), ya resuelto por
// `authenticate`. Dispatch lo consulta para el administrador de plataforma y así ambos servicios aplican el mismo.
router.get('/plataforma/contexto', authenticate, tenantsController.getEffectiveContext);
router.get('/tenants/:id/usuarios', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.listTenantUsers);

module.exports = router;
