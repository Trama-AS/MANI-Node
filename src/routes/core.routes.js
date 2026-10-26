const { Router } = require('express');
const multer = require('multer');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const verificationController = require('../controllers/verification.controller');
const availabilityController = require('../controllers/availability.controller');
const dispatchIntegrationController = require('../controllers/dispatchIntegration.controller');
const requestsController = require('../controllers/requests.controller');
const notificationsController = require('../controllers/notifications.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

const router = Router();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const photoMiddleware = uploadPhoto.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'foto', maxCount: 1 },
]);
// Fotos de la solicitud (SCRUM-1072): hasta 5 imágenes de 5 MB en el campo `fotos`.
const uploadFotosSolicitud = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
// SCRUM-854: una ruta por operación sobre el perfil propio. Los datos van por PATCH (JSON) y la foto
// solo por subida de archivo; no hay ruta por :id porque el caso de uso edita únicamente el perfil propio.
router.patch('/profiles/me', profilesController.updateOwnProfile);
router.post('/profiles/me/photo', photoMiddleware, profilesController.updateOwnProfilePhoto);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);
router.get('/profiles/me/unavailability', availabilityController.listAbsences);
router.post('/profiles/me/unavailability', availabilityController.createAbsence);
router.patch('/profiles/me/unavailability/:absenceId', availabilityController.updateAbsence);
router.delete('/profiles/me/unavailability/:absenceId', availabilityController.deleteAbsence);

// US-02.1.3-M2 (SCRUM-1066): bandeja de verificación de aliados y acceso temporal a documentos KYC.
// Una ruta por operación; PATCH es el verbo para resolver.
router.get('/aliados/verificacion', verificationController.listAlliesVerification);
router.get('/aliados/:id/verificacion', verificationController.getAllyVerificationDetail);
router.patch('/aliados/:id/verificacion', verificationController.resolveAllyVerification);
router.get('/aliados/:id/documentos/:documentoId/url', verificationController.getKycDocumentSignedUrl);
// Superficie que consume MANI-Dispatch (ADR-0030): Core es dueño de la elegibilidad y de la mensajería.
router.get('/allies/eligible', authenticate, dispatchIntegrationController.listEligibleAllies);
router.get('/allies/me', authenticate, dispatchIntegrationController.getOwnAllyProfile);
// HU-M07-04 (SCRUM-871): el cliente consulta sus solicitudes. Van antes de las rutas `/solicitudes/:id/...`.
router.get('/solicitudes/me', authenticate, requestsController.listOwnRequests);
router.get('/solicitudes/me/:id', authenticate, requestsController.getOwnRequest);
router.get('/solicitudes/:id/context', authenticate, dispatchIntegrationController.getSolicitudContext);
router.post('/notifications', authenticate, dispatchIntegrationController.publishNotification);
router.get('/notifications', authenticate, dispatchIntegrationController.listNotifications);
// HU-M09-06 (SCRUM-1428): bandeja propia de notificaciones. Va bajo /profiles/me porque el Gateway cierra al
// tráfico externo cualquier ruta /notifications, que es superficie interna de Dispatch.
router.get('/profiles/me/inbox', authenticate, notificationsController.listMyInbox);
// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core; el despacho es un paso posterior en Dispatch.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);

// Vitrina pública del catálogo (usada por el formulario de registro de
// aliado, pre-auth): devuelve las categorías globales de fixtures más las
// del tenant resuelto desde X-Tenant-Slug (si el caller lo envía). Sin ese
// encabezado solo se ven las globales, nunca las de otro tenant.
router.get('/catalog', catalogController.listCategories);

// Gestión de categoría de servicio (US-03.1.1-M2.1), aislada por tenant:
// solo Backoffice (rol ADMIN) y siempre autenticado.
const requireAdmin = requireRole('ADMIN');
router.get('/catalog/categories', authenticate, requireAdmin, catalogController.listCategoriesForTenant);
router.post('/catalog/categories', authenticate, requireAdmin, catalogController.createCategory);
router.get('/catalog/categories/:id', authenticate, requireAdmin, catalogController.getCategory);
router.put('/catalog/categories/:id', authenticate, requireAdmin, catalogController.updateCategory);
router.patch('/catalog/categories/:id/activate', authenticate, requireAdmin, catalogController.activateCategory);
router.patch('/catalog/categories/:id/deactivate', authenticate, requireAdmin, catalogController.deactivateCategory);

module.exports = router;

