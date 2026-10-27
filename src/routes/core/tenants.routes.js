const { Router } = require('express');
const tenantsController = require('../../controllers/tenants.controller');

// Dominio Tenants (organizaciones). Hoy es pública; su exposición se revisa en SCRUM-1364.
const router = Router();

router.get('/tenants', tenantsController.listTenants);

module.exports = router;
