const { Router } = require('express');
const verificationController = require('../../controllers/verification.controller');

// Dominio Verificación de aliados (US-02.1.3-M2, SCRUM-1066): bandeja y acceso temporal a documentos KYC.
// Una ruta por operación; PATCH es el verbo para resolver.
const router = Router();

router.get('/aliados/verificacion', verificationController.listAlliesVerification);
router.get('/aliados/:id/verificacion', verificationController.getAllyVerificationDetail);
router.patch('/aliados/:id/verificacion', verificationController.resolveAllyVerification);
router.get('/aliados/:id/documentos/:documentoId/url', verificationController.getKycDocumentSignedUrl);

module.exports = router;
