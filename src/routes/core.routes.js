const { Router } = require('express');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const authenticate = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/authorize.middleware');

const router = Router();

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);

// Vitrina pública del catálogo (usada por el formulario de registro de
// aliado, pre-auth): devuelve categorías globales de todos los tenants.
router.get('/catalog', catalogController.listCategories);

// Gestión de categoría de servicio (US-03.1.1-M2.1), aislada por tenant:
// solo Backoffice (rol ADMIN) y siempre autenticado.
const requireAdmin = requireRole('ADMIN');
router.get('/catalog/categories', authenticate, requireAdmin, catalogController.listCategoriesForTenant);
router.post('/catalog/categories', authenticate, requireAdmin, catalogController.createCategory);
router.get('/catalog/categories/:id', authenticate, requireAdmin, catalogController.getCategory);
router.put('/catalog/categories/:id', authenticate, requireAdmin, catalogController.updateCategory);
router.patch('/catalog/categories/:id/activate', authenticate, requireAdmin, catalogController.activateCategory);
router.patch('/catalog/categories/:id/deactivate', authenticate, requireAdmin, catalogController.deactivateCategory);

module.exports = router;
