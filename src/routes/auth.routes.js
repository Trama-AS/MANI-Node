const { Router } = require('express');
const multer = require('multer');
const authController = require('../controllers/auth.controller');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// upload.any() acepta cualquier nombre de campo de archivo: el cliente nombra
// cada documento KYC con su tipo en minúsculas (cedula_ciudadania, rut_certificado, ...).
router.post('/auth/register/ally', upload.any(), authController.registerAllyNaturalPerson);

module.exports = router;
