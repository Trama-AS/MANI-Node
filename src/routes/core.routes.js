const { Router } = require('express');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const quotesController = require('../controllers/quotes.controller');
const servicesController = require('../controllers/services.controller');
const authenticate = require('../middlewares/auth.middleware');

const router = Router();

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);
router.get('/catalog', catalogController.listCategories);

// RF-15 / US-04.2.1 / SCRUM-865: Cotización con mano de obra y materiales separados
router.post('/cotizaciones', authenticate, quotesController.createQuote);
router.post('/solicitudes/:solicitudId/cotizaciones', authenticate, quotesController.createQuote);

// RF-17 / US-04.2.3 / SCRUM-867: Cliente acepta/rechaza/ajusta cotización
router.post('/cotizaciones/:id/aceptar', authenticate, quotesController.acceptQuote);
router.post('/cotizaciones/:id/rechazar', authenticate, quotesController.rejectQuote);
router.post('/cotizaciones/:id/ajustar', authenticate, quotesController.adjustQuote);
router.post('/cotizaciones/:id/solicitar-ajuste', authenticate, quotesController.adjustQuote);
router.post('/cotizaciones/:id/responder', authenticate, quotesController.respondQuote);

// RF-18 / US-04.3.1 / SCRUM-868: Marcar inicio/fin de ejecución
router.post('/solicitudes/:id/iniciar', authenticate, servicesController.startExecution);
router.post('/solicitudes/:id/iniciar-ejecucion', authenticate, servicesController.startExecution);
router.post('/servicios/:id/iniciar', authenticate, servicesController.startExecution);
router.post('/solicitudes/:id/finalizar', authenticate, servicesController.finishExecution);
router.post('/solicitudes/:id/finalizar-ejecucion', authenticate, servicesController.finishExecution);
router.post('/servicios/:id/finalizar', authenticate, servicesController.finishExecution);

// RF-18 / US-04.3.2 / SCRUM-869: Registrar eventos durante la ejecución
router.post('/solicitudes/:id/eventos', authenticate, servicesController.registerEvent);
router.post('/servicios/:id/eventos', authenticate, servicesController.registerEvent);

// RF-18 / US-04.6.1 / SCRUM-879: Consultar historial de servicios
router.get('/solicitudes/historial', authenticate, servicesController.getClientServicesHistory);
router.get('/servicios/historial', authenticate, servicesController.getClientServicesHistory);
router.get('/solicitudes/me', authenticate, servicesController.getClientServicesHistory);

// RF-18 / US-04.3.3 / SCRUM-870: Cliente consulta el log del servicio
router.get('/solicitudes/:id/log', authenticate, servicesController.getServiceLog);
router.get('/solicitudes/:id/historial', authenticate, servicesController.getServiceLog);
router.get('/servicios/:id/log', authenticate, servicesController.getServiceLog);

module.exports = router;
