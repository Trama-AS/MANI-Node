const { Router } = require('express');
const tenantsRoutes = require('./core/tenants.routes');
const profilesRoutes = require('./core/profiles.routes');
const availabilityRoutes = require('./core/availability.routes');
const verificationRoutes = require('./core/verification.routes');
const requestsRoutes = require('./core/requests.routes');
const dispatchIntegrationRoutes = require('./core/dispatchIntegration.routes');
const notificationsRoutes = require('./core/notifications.routes');
const quotesRoutes = require('./core/quotes.routes');
const paymentsRoutes = require('./core/payments.routes');
const executionRoutes = require('./core/execution.routes');
const catalogRoutes = require('./core/catalog.routes');
const messagesRoutes = require('./core/messages.routes');
const auditRoutes = require('./core/audit.routes');

// Rutas de Core agrupadas por dominio interno (SCRUM-1447, RNF-02, ADR-0022). Un solo servicio desplegable:
// cada archivo es un límite de dominio, no un microservicio. Dos rutas que pueden atender la misma URL conservan
// el orden relativo que tenían en el archivo único (por eso Solicitudes, con `/solicitudes/me/...`, va antes que
// los dominios con `/solicitudes/:id/...`); tests/integration/routes/routeInventory.test.js lo comprueba.
const router = Router();

router.use(tenantsRoutes);
router.use(profilesRoutes);
router.use(availabilityRoutes);
router.use(verificationRoutes);
router.use(requestsRoutes);
router.use(dispatchIntegrationRoutes);
router.use(notificationsRoutes);
router.use(quotesRoutes);
router.use(paymentsRoutes);
router.use(executionRoutes);
router.use(catalogRoutes);
router.use(messagesRoutes);
router.use(auditRoutes);

module.exports = router;
