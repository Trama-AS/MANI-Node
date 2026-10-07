const { Router } = require('express');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');

const router = Router();

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
router.get('/catalog', catalogController.listCategories);

module.exports = router;
