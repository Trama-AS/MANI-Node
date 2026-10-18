const { Router } = require('express');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const verificationController = require('../controllers/verification.controller');

const router = Router();

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);
router.get('/catalog', catalogController.listCategories);

// US-02.1.3-M2 (SCRUM-1066): Bandeja de verificación de aliados y acceso temporal a documentos KYC
router.get('/aliados/verificacion', verificationController.listAlliesVerification);
router.get('/aliados/:id/verificacion', verificationController.getAllyVerificationDetail);
router.get('/aliados/:id', verificationController.getAllyVerificationDetail);
router.patch('/aliados/:id/verificacion', verificationController.resolveAllyVerification);
router.post('/aliados/:id/verificacion', verificationController.resolveAllyVerification);
router.get('/aliados/:id/documentos/:documentoId/url', verificationController.getKycDocumentSignedUrl);
router.post('/aliados/:id/documentos/url-firmada', verificationController.getKycDocumentSignedUrl);
router.post('/documentos-kyc/url-firmada', verificationController.getKycDocumentSignedUrl);

module.exports = router;

