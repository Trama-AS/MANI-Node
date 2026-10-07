const { Router } = require('express');
const healthRoutes = require('./health.routes');
const coreRoutes = require('./core.routes');
const authRoutes = require('./auth.routes');
const employeesRoutes = require('../features/ally/presentation/employees.routes');

const router = Router();

router.use(healthRoutes);
router.use('/api/v1', authRoutes);
router.use('/api/v1', coreRoutes);
// RF-05: Registro de Empleado Directo (SCRUM-850)
router.use('/api/v1/allies/employees', employeesRoutes);
// El Gateway recorta "/api/v1/core/" por completo (no solo "/core") antes de
// reenviar a Core (ver MANI-APIGateway/nginx.conf: proxy_pass con "/" termina
// en el upstream), así que las rutas también deben responder en la raíz.
router.use('/', authRoutes);
router.use('/allies/employees', employeesRoutes);
router.use('/aliados/empleados', employeesRoutes);
router.use('/', coreRoutes);

module.exports = router;
