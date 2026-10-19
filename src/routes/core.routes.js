const { Router } = require('express');
const multer = require('multer');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const quotesController = require('../controllers/quotes.controller');
const servicesController = require('../controllers/services.controller');
const availabilityController = require('../controllers/availability.controller');
const requestsController = require('../controllers/requests.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = Router();

// Evidencia de eventos del servicio (SCRUM-869): una imagen de hasta 5 MB en el campo `foto`.
const uploadEvidencia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
// Fotos de la solicitud (SCRUM-1072): hasta 5 imágenes de 5 MB en el campo `fotos`.
const uploadFotosSolicitud = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

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
// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core; el despacho es un paso posterior en Dispatch.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);

// RF-17 / US-04.2.3 / SCRUM-867: Cliente acepta/rechaza/ajusta cotización
router.post('/cotizaciones/:id/aceptar', authenticate, quotesController.acceptQuote);
router.post('/cotizaciones/:id/rechazar', authenticate, quotesController.rejectQuote);
router.post('/cotizaciones/:id/ajustar', authenticate, quotesController.adjustQuote);

// RF-18 / US-04.3.1 / SCRUM-868: Marcar inicio/fin de ejecución
router.post('/solicitudes/:id/iniciar', authenticate, servicesController.startExecution);
router.post('/solicitudes/:id/finalizar', authenticate, servicesController.finishExecution);

// RF-18 / US-04.3.2 / SCRUM-869: Registrar eventos durante la ejecución
router.post('/solicitudes/:id/eventos', authenticate, uploadEvidencia.single('foto'), servicesController.registerEvent);

// RF-18 / US-04.3.3 / SCRUM-870: Cliente consulta el log del servicio
router.get('/solicitudes/:id/log', authenticate, servicesController.getServiceLog);

module.exports = router;
