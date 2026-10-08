const { Router } = require('express');
const authenticate = require('../middlewares/auth.middleware');
const sitesController = require('../controllers/sites.controller');

const router = Router();

// Todas las rutas de sedes y reglas exigen sesión autenticada (ADR-0018)
router.use('/sites', authenticate);

// Configuración de reglas (cliente empresa / admin)
router.patch('/sites/:id/rules', sitesController.configureSiteRules);
router.put('/sites/:id/rules', sitesController.configureSiteRules);
router.patch('/sites/:id/reglas', sitesController.configureSiteRules);
router.put('/sites/:id/reglas', sitesController.configureSiteRules);

// Consulta destacada de reglas para aliados antes de agendar (RF-09 / QS-06)
router.get('/sites/:id/rules', sitesController.getSiteRulesForAlly);
router.get('/sites/:id/reglas', sitesController.getSiteRulesForAlly);

// Validación de horario propuesto por el aliado contra las reglas del sitio
router.post('/sites/:id/validate-schedule', sitesController.validateAllySchedule);

module.exports = router;
