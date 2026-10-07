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
router.use('/api/v1/clients', clientsRoutes);
router.use('/clientes', clientsRoutes);
router.use('/api/v1/sites', sitesRoutes);
router.use('/sitios', sitesRoutes);
router.use('/', coreRoutes);

module.exports = router;
