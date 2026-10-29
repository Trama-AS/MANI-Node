const { Router } = require('express');
const catalogController = require('../../controllers/catalog.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// Dominio Catálogo: categorías de servicio y zonas geográficas.
const router = Router();

// Vitrina pública del catálogo (usada por el formulario de registro de
// aliado, pre-auth): devuelve las categorías globales de fixtures más las
// del tenant resuelto desde X-Tenant-Slug (si el caller lo envía). Sin ese
// encabezado solo se ven las globales, nunca las de otro tenant.
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

// Catálogo jerárquico de zonas geográficas (HU-M04-04, REST-01). Solo
// lectura: el catálogo lo administra la infraestructura de datos, no este
// servicio. Requiere JWT verificado (T4/T7) aunque la tabla sea global,
// porque es la única forma de no confiar en un tenant enviado por el cliente.
router.get('/catalog/zones', authenticate, catalogController.listZoneCatalog);
router.get('/catalog/zones/:id', authenticate, catalogController.getZone);

module.exports = router;
