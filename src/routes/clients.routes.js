const { Router } = require('express');
const authenticate = require('../middlewares/auth.middleware');
const clientsController = require('../controllers/clients.controller');

const router = Router();

// Aplica autenticación obligatoria a todas las operaciones de cliente empresa (ADR-0018)
router.use(authenticate);

router.post('/company', clientsController.registerCompany);
router.post('/', clientsController.registerCompany);
router.post('/companies/:id/sites', clientsController.addSite);
router.get('/companies/:id/sites', clientsController.getSites);
router.post('/:id/sites', clientsController.addSite);
router.get('/:id/sites', clientsController.getSites);

module.exports = router;
