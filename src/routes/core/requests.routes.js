const { Router } = require('express');
const multer = require('multer');
const requestsController = require('../../controllers/requests.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Solicitudes de servicio. Core crea la solicitud y es dueño de su estado tras la asignación
// (decisión 6A, SAD §7.4); el despacho es un paso posterior en Dispatch.
// Se monta antes que los dominios con rutas `/solicitudes/:id/...`: `/solicitudes/me/:id` tiene que ganarle a
// `/solicitudes/:id/context` (y a las demás lecturas por id) cuando la URL es, por ejemplo, `/solicitudes/me/context`.
const router = Router();

// Fotos de la solicitud (SCRUM-1072): hasta 5 imágenes de 5 MB en el campo `fotos`.
const uploadFotosSolicitud = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

// HU-M07-04 (SCRUM-871): el cliente consulta sus solicitudes.
router.get('/solicitudes/me', authenticate, requestsController.listOwnRequests);
router.get('/solicitudes/me/:id', authenticate, requestsController.getOwnRequest);
// US-04.5.1 (SCRUM-877): el cliente cancela su solicitud antes de la ejecución.
router.patch('/solicitudes/me/:id/cancelar', authenticate, requestsController.cancelOwnRequest);
// HU-M05-07 (SCRUM-1403), decisión 6A: comando interno de asignación; solo lo llama Dispatch (el Gateway lo bloquea).
router.post('/solicitudes/:id/asignacion', authenticate, requestsController.assignRequest);
// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);

module.exports = router;
