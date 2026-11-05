const { Router } = require('express');
const { identificarSiHayToken } = require('../../middlewares/auth.middleware');
const verificationController = require('../../controllers/verification.controller');

// Dominio Verificación de aliados (US-02.1.3-M2, SCRUM-1066): bandeja y acceso temporal a documentos KYC.
// Una ruta por operación; PATCH es el verbo para resolver.
// identificarSiHayToken: las políticas de documento_kyc exigen el rol admin_tenant en app.set_context (SCRUM-1468).
const router = Router();

router.get('/aliados/verificacion', identificarSiHayToken, verificationController.listAlliesVerification);
router.get('/aliados/:id/verificacion', identificarSiHayToken, verificationController.getAllyVerificationDetail);
router.patch('/aliados/:id/verificacion', identificarSiHayToken, verificationController.resolveAllyVerification);
router.get(
  '/aliados/:id/documentos/:documentoId/url',
  identificarSiHayToken,
  verificationController.getKycDocumentSignedUrl
);

module.exports = router;
