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
const quotesController = require('../controllers/quotes.controller');
const paymentsController = require('../controllers/payments.controller');
const executionController = require('../controllers/execution.controller');
const serviceEventsController = require('../controllers/serviceEvents.controller');
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
// Evidencia de un evento del servicio (SCRUM-869): una imagen de 5 MB en el campo `foto`.
const uploadEvidencia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// SCRUM-1364: el listado global de tenants es de la administración de plataforma. Antes no pedía sesión y cualquiera
// podía enumerar todas las empresas; ahora exige autenticación y el permiso explícito PLATFORM_ADMIN, que ningún rol
// de tenant (ni siquiera admin_tenant) incluye. Cada persona ve el nombre de su propio tenant en GET /profiles/me.
router.get('/tenants', authenticate, requireRole('PLATFORM_ADMIN'), tenantsController.listTenants);
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
// US-04.5.1 (SCRUM-877): el cliente cancela su solicitud antes de la ejecución.
router.patch('/solicitudes/me/:id/cancelar', authenticate, requestsController.cancelOwnRequest);
router.get('/solicitudes/:id/context', authenticate, dispatchIntegrationController.getSolicitudContext);
router.post('/notifications', authenticate, dispatchIntegrationController.publishNotification);
router.get('/notifications', authenticate, dispatchIntegrationController.listNotifications);
// HU-M09-06 (SCRUM-1428): bandeja propia de notificaciones. Va bajo /profiles/me porque el Gateway cierra al
// tráfico externo cualquier ruta /notifications, que es superficie interna de Dispatch.
router.get('/profiles/me/inbox', authenticate, notificationsController.listMyInbox);
// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core; el despacho es un paso posterior en Dispatch.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);
// US-04.2.1 (SCRUM-865): el aliado asignado cotiza; el cliente dueño y ese aliado consultan las versiones.
router.post('/solicitudes/:id/cotizaciones', authenticate, quotesController.createQuote);
router.get('/solicitudes/:id/cotizaciones', authenticate, quotesController.listQuotes);
// US-04.2.3 (SCRUM-867): el cliente dueño acepta, rechaza o pide ajustar la cotización pendiente.
router.post('/cotizaciones/:id/aceptar', authenticate, quotesController.acceptQuote);
router.post('/cotizaciones/:id/rechazar', authenticate, quotesController.rejectQuote);
router.post('/cotizaciones/:id/ajustar', authenticate, quotesController.adjustQuote);
// HU-M11-01 (SCRUM-1432): pago en el sandbox simulado. Solo el cliente que paga ve sus pagos y comprobantes.
router.post('/pagos', authenticate, paymentsController.createPayment);
router.get('/pagos/:id', authenticate, paymentsController.getPayment);
router.get('/pagos/:id/comprobante', authenticate, paymentsController.getReceipt);
// US-04.3.1 (SCRUM-868): el aliado asignado marca inicio y fin; el cliente dueño y el aliado consultan las marcas.
router.post('/solicitudes/:id/iniciar', authenticate, executionController.startExecution);
router.post('/solicitudes/:id/finalizar', authenticate, executionController.finishExecution);
router.get('/solicitudes/:id/ejecucion', authenticate, executionController.getExecution);
// US-04.3.2 (SCRUM-869): el aliado asignado registra eventos durante la ejecución; dueño y aliado los consultan.
router.post('/solicitudes/:id/eventos', authenticate, uploadEvidencia.single('foto'), serviceEventsController.registerEvent);
router.get('/solicitudes/:id/eventos', authenticate, serviceEventsController.listEvents);
// US-04.3.3 (SCRUM-870): URL temporal de la foto de un evento para el cliente dueño o el aliado asignado.
router.get('/solicitudes/:id/eventos/:eventoId/evidencia', authenticate, serviceEventsController.getEventEvidence);

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

