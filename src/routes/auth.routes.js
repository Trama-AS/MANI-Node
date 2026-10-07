const { Router } = require('express');
const multer = require('multer');
const authController = require('../controllers/auth.controller');

const router = Router();

// Whitelist de documentos KYC que acepta el contrato (docs/openapi/core.yaml
// en MANI-APIGateway): antes upload.any() convertía CUALQUIER nombre de
// campo en un "tipo de documento" válido (probado en code review: un campo
// llamado "lo_que_sea" terminaba creando un documento_kyc con ese tipo).
const ALLOWED_DOCUMENT_FIELDS = ['cedula_ciudadania', 'rut_certificado'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_DOCUMENT_FIELDS.length },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      const err = new Error(`Tipo de archivo no permitido: ${file.mimetype}`);
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      return cb(err);
    }
    cb(null, true);
  },
});

// upload.fields() (a diferencia de upload.any()) rechaza automáticamente
// cualquier campo de archivo fuera de ALLOWED_DOCUMENT_FIELDS con
// MulterError LIMIT_UNEXPECTED_FILE (mapeado a 400 en errorHandler.middleware.js).
router.post(
  '/auth/register/ally',
  upload.fields(ALLOWED_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
  authController.registerAllyNaturalPerson
);

module.exports = router;
