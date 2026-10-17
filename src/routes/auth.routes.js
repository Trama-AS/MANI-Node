const { Router } = require('express');
const multer = require('multer');
const authController = require('../controllers/auth.controller');

const router = Router();

// Whitelist de documentos KYC que acepta el contrato (docs/openapi/core.yaml
// en MANI-APIGateway): antes upload.any() convertía CUALQUIER nombre de
// campo en un "tipo de documento" válido (probado en code review: un campo
// llamado "lo_que_sea" terminaba creando un documento_kyc con ese tipo).
const ALLOWED_DOCUMENT_FIELDS = ['cedula_ciudadania', 'rut_certificado'];
const ALLOWED_COMPANY_DOCUMENT_FIELDS = ['camara_comercio', 'rut_empresa', 'cedula_representante'];
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const err = new Error(`Tipo de archivo no permitido: ${file.mimetype}`);
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_DOCUMENT_FIELDS.length },
  fileFilter,
});

const uploadCompany = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: ALLOWED_COMPANY_DOCUMENT_FIELDS.length },
  fileFilter,
});

// upload.fields() (a diferencia de upload.any()) rechaza automáticamente
// cualquier campo de archivo fuera de la whitelist con
// MulterError LIMIT_UNEXPECTED_FILE (mapeado a 400 en errorHandler.middleware.js).
router.post(
  '/auth/register/ally',
  upload.fields(ALLOWED_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
  authController.registerAllyNaturalPerson
);

const companyFieldsMiddleware = uploadCompany.fields(
  ALLOWED_COMPANY_DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))
);

router.post('/auth/register/ally/company', companyFieldsMiddleware, authController.registerAllyCompany);
router.post('/aliados/empresa', companyFieldsMiddleware, authController.registerAllyCompany);

module.exports = router;

