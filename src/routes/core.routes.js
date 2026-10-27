const { Router } = require('express');
const tenantsRoutes = require('./core/tenants.routes');
const profilesRoutes = require('./core/profiles.routes');
const availabilityRoutes = require('./core/availability.routes');
const verificationRoutes = require('./core/verification.routes');
const dispatchIntegrationRoutes = require('./core/dispatchIntegration.routes');
const notificationsRoutes = require('./core/notifications.routes');
const requestsRoutes = require('./core/requests.routes');
const catalogRoutes = require('./core/catalog.routes');

// Rutas de Core agrupadas por dominio interno (SCRUM-1447, RNF-02, ADR-0022). Un solo servicio desplegable:
// cada archivo es un límite de dominio, no un microservicio. El orden de montaje conserva el de registro
// anterior, y tests/integration/routes/routeInventory.test.js fija el inventario de rutas.
const router = Router();

router.use(tenantsRoutes);
router.use(profilesRoutes);
router.use(availabilityRoutes);
router.use(verificationRoutes);
router.use(dispatchIntegrationRoutes);
router.use(notificationsRoutes);
router.use(requestsRoutes);
router.use(catalogRoutes);

module.exports = router;
