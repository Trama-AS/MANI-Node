const { Router } = require('express');
const multer = require('multer');
const executionController = require('../../controllers/execution.controller');
const serviceEventsController = require('../../controllers/serviceEvents.controller');
const additionsController = require('../../controllers/additions.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Ejecución del servicio (M-07): marcas de inicio y fin, bitácora de eventos con evidencia y adiciones.
const router = Router();

// Evidencia de un evento del servicio (SCRUM-869): una imagen de 5 MB en el campo `foto`.
const uploadEvidencia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// US-04.3.1 (SCRUM-868): el aliado asignado marca inicio y fin; el cliente dueño y el aliado consultan las marcas.
router.post('/solicitudes/:id/iniciar', authenticate, executionController.startExecution);
router.post('/solicitudes/:id/finalizar', authenticate, executionController.finishExecution);
router.get('/solicitudes/:id/ejecucion', authenticate, executionController.getExecution);
// US-04.3.2 (SCRUM-869): el aliado asignado registra eventos durante la ejecución; dueño y aliado los consultan.
router.post('/solicitudes/:id/eventos', authenticate, uploadEvidencia.single('foto'), serviceEventsController.registerEvent);
router.get('/solicitudes/:id/eventos', authenticate, serviceEventsController.listEvents);
// US-04.3.3 (SCRUM-870): URL temporal de la foto de un evento para el cliente dueño o el aliado asignado.
router.get('/solicitudes/:id/eventos/:eventoId/evidencia', authenticate, serviceEventsController.getEventEvidence);
// US-04.3.5 (SCRUM-872): el aliado asignado pide una adición durante la ejecución; el cliente dueño la acepta o la
// rechaza. Ambos consultan las adiciones y el total vigente.
router.post('/solicitudes/:id/adiciones', authenticate, additionsController.requestAddition);
router.get('/solicitudes/:id/adiciones', authenticate, additionsController.listAdditions);
router.post('/adiciones/:id/aceptar', authenticate, additionsController.acceptAddition);
router.post('/adiciones/:id/rechazar', authenticate, additionsController.rejectAddition);

module.exports = router;
