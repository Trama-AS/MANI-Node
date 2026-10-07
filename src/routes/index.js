const { Router } = require('express');
const healthRoutes = require('./health.routes');
const coreRoutes = require('./core.routes');
const authRoutes = require('./auth.routes');
const clientsRoutes = require('../features/client/presentation/clients.routes');
const sitesRoutes = require('../features/client/presentation/sites.routes');

const router = Router();

router.use(healthRoutes);
router.use('/api/v1', authRoutes);
router.use('/api/v1', coreRoutes);
// RF-08 / RF-09: clientes empresa, sitios y reglas contextuales (SCRUM-852 / SCRUM-853)
router.use('/api/v1/clients', clientsRoutes);
router.use('/api/v1/sites', sitesRoutes);
// El Gateway recorta "/api/v1/core/" por completo (no solo "/core") antes de
// reenviar a Core (ver MANI-APIGateway/nginx.conf: proxy_pass con "/" termina
// en el upstream), así que las rutas también deben responder en la raíz.
router.use('/', authRoutes);
router.use('/clients', clientsRoutes);
router.use('/sites', sitesRoutes);
// Alias en español según contrato DD_V2 (§5.2)
router.use('/clientes', clientsRoutes);
router.use('/sitios', sitesRoutes);
router.use('/', coreRoutes);

module.exports = router;
