const { Router } = require('express');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const quotesController = require('../controllers/quotes.controller');
const authenticate = require('../middlewares/auth.middleware');
const availabilityController = require('../controllers/availability.controller');

const router = Router();

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);
router.get('/profiles/me/unavailability', availabilityController.listAbsences);
router.post('/profiles/me/unavailability', availabilityController.createAbsence);
router.patch('/profiles/me/unavailability/:absenceId', availabilityController.updateAbsence);
router.delete('/profiles/me/unavailability/:absenceId', availabilityController.deleteAbsence);
router.get('/catalog', catalogController.listCategories);

// RF-15 / US-04.2.1 / SCRUM-865: Cotización con mano de obra y materiales separados
router.post('/solicitudes/:solicitudId/cotizaciones', authenticate, quotesController.createQuote);

// RF-17 / US-04.2.3 / SCRUM-867: Cliente acepta/rechaza/ajusta cotización
router.post('/cotizaciones/:id/aceptar', authenticate, quotesController.acceptQuote);
router.post('/cotizaciones/:id/rechazar', authenticate, quotesController.rejectQuote);
router.post('/cotizaciones/:id/ajustar', authenticate, quotesController.adjustQuote);
router.post('/cotizaciones/:id/solicitar-ajuste', authenticate, quotesController.adjustQuote);
router.post('/cotizaciones/:id/responder', authenticate, quotesController.respondQuote);

module.exports = router;
