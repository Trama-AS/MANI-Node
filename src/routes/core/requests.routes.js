const { Router } = require('express');
const multer = require('multer');
const requestsController = require('../../controllers/requests.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Solicitudes de servicio. Core crea la solicitud y es dueño de su estado tras la asignación
// (decisión 6A, SAD §7.4); el despacho es un paso posterior en Dispatch.
const router = Router();

// Fotos de la solicitud (SCRUM-1072): hasta 5 imágenes de 5 MB en el campo `fotos`.
const uploadFotosSolicitud = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

// US-04.1.1-M2 (SCRUM-1072): el cliente crea la solicitud en Core.
router.post('/solicitudes', authenticate, uploadFotosSolicitud.array('fotos', 5), requestsController.createRequest);

module.exports = router;
