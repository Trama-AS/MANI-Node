const { Router } = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { DomainError } = require('../domain/errors/DomainError');
const employeesController = require('../controllers/employees.controller');

const router = Router();

// SCRUM-1376: copia del documento de identidad, una sola, hasta 5 MB (PDF, JPG o PNG: lo valida el caso de uso).
const uploadDocumento = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function recibirDocumento(req, res, next) {
  uploadDocumento.single('documento_identidad')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return next(new DomainError('El documento no puede superar 5 MB', 'DOCUMENT_TOO_LARGE', 413));
    }
    return next(err);
  });
}

// RF-05 / US-02.1.5 / SCRUM-850 / SCRUM-1376: registro de empleado directo por Admin del Tenant.
// Primero rol, después el archivo: un rol no permitido se rechaza sin leer el cuerpo.
const registrar = [authenticate, requireRole('ADMIN'), recibirDocumento, employeesController.registerDirectEmployee];

router.post('/allies/employees', ...registrar);
router.post('/allies/direct-employees', ...registrar);
// Alias de administración
router.post('/admin/employees', ...registrar);

module.exports = router;
