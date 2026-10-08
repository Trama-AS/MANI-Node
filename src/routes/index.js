const { Router } = require('express');
const healthRoutes = require('./health.routes');
const coreRoutes = require('./core.routes');
const authRoutes = require('./auth.routes');
const legalRoutes = require('./legal.routes');

const router = Router();

router.use(healthRoutes);
router.use('/api/v1', authRoutes);
router.use('/api/v1', coreRoutes);
router.use('/api/v1', legalRoutes);
// El Gateway recorta "/api/v1/core/" por completo (no solo "/core") antes de
// reenviar a Core (ver MANI-APIGateway/nginx.conf: proxy_pass con "/" termina
// en el upstream), así que las rutas también deben responder en la raíz.
router.use('/', authRoutes);
router.use('/', coreRoutes);
router.use('/', legalRoutes);

module.exports = router;

