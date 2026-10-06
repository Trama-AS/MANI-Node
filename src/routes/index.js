const { Router } = require('express');
const healthRoutes = require('./health.routes');
const coreRoutes = require('./core.routes');

const router = Router();

router.use(healthRoutes);
router.use('/api/v1', coreRoutes);
router.use('/', coreRoutes);

module.exports = router;
