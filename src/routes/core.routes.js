const { Router } = require('express');
const multer = require('multer');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const verificationController = require('../controllers/verification.controller');
const availabilityController = require('../controllers/availability.controller');
const requestsController = require('../controllers/requests.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = Router();

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

// US-02.1.3-M2 (SCRUM-1066): bandeja de verificación de aliados y acceso temporal a documentos KYC.
// Una ruta por operación; PATCH es el verbo para resolver.
router.get('/aliados/verificacion', verificationController.listAlliesVerification);
router.get('/aliados/:id/verificacion', verificationController.getAllyVerificationDetail);
router.patch('/aliados/:id/verificacion', verificationController.resolveAllyVerification);
router.get('/aliados/:id/documentos/:documentoId/url', verificationController.getKycDocumentSignedUrl);
// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core; el despacho es un paso posterior en Dispatch.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);

module.exports = router;

