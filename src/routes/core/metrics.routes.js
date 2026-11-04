const { Router } = require('express');
const metricsController = require('../../controllers/metrics.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Métricas (M-12). SCRUM-900: agregados operativos del tenant de la sesión para un periodo.
const router = Router();

router.get('/metricas/operativas', authenticate, metricsController.getOperationalMetrics);

module.exports = router;
