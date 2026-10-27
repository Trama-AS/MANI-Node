const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');

// SCRUM-1447: regresión de la modularización interna de Core. Toda ruta que existía antes de agrupar
// core.routes.js por dominio debe seguir registrada con el mismo método y la misma cadena de middlewares
// (autenticación y rol incluidos). Una ruta nueva no rompe la prueba; quitar o desproteger una sí.
const RUTAS_PREVIAS = [
  'GET /health [getHealth]',
  '_ALL /api/v1/auth/validate-token [<anonymous>]',
  'POST /api/v1/auth/dev-token [<anonymous>]',
  'POST /api/v1/auth/register/ally [multerMiddleware,registerAllyNaturalPerson]',
  'POST /api/v1/auth/register/ally/company [multerMiddleware,registerAllyCompany]',
  'POST /api/v1/auth/register/client [registerClientNaturalPerson]',
  'POST /api/v1/auth/register/client/company [registerClientCompany]',
  'GET /api/v1/tenants [listTenants]',
  'GET /api/v1/profiles/me [getOwnProfile]',
  'PATCH /api/v1/profiles/me [updateOwnProfile]',
  'POST /api/v1/profiles/me/photo [multerMiddleware,updateOwnProfilePhoto]',
  'GET /api/v1/profiles/me/categories [getAllyCategories]',
  'GET /api/v1/profiles/me/categories/available [listAvailableAllyCategories]',
  'PUT /api/v1/profiles/me/categories [declareAllyCategories]',
  'POST /api/v1/profiles/me/categories [declareAllyCategories]',
  'GET /api/v1/profiles/me/unavailability [listAbsences]',
  'POST /api/v1/profiles/me/unavailability [createAbsence]',
  'PATCH /api/v1/profiles/me/unavailability/:absenceId [updateAbsence]',
  'DELETE /api/v1/profiles/me/unavailability/:absenceId [deleteAbsence]',
  'GET /api/v1/aliados/verificacion [listAlliesVerification]',
  'GET /api/v1/aliados/:id/verificacion [getAllyVerificationDetail]',
  'PATCH /api/v1/aliados/:id/verificacion [resolveAllyVerification]',
  'GET /api/v1/aliados/:id/documentos/:documentoId/url [getKycDocumentSignedUrl]',
  'GET /api/v1/allies/eligible [authenticate,listEligibleAllies]',
  'GET /api/v1/allies/me [authenticate,getOwnAllyProfile]',
  'GET /api/v1/solicitudes/:id/context [authenticate,getSolicitudContext]',
  'POST /api/v1/notifications [authenticate,publishNotification]',
  'GET /api/v1/notifications [authenticate,listNotifications]',
  'GET /api/v1/profiles/me/inbox [authenticate,listMyInbox]',
  'POST /api/v1/solicitudes [authenticate,multerMiddleware,createRequest]',
  'GET /api/v1/catalog [listCategories]',
  'GET /api/v1/catalog/categories [authenticate,<anonymous>,listCategoriesForTenant]',
  'POST /api/v1/catalog/categories [authenticate,<anonymous>,createCategory]',
  'GET /api/v1/catalog/categories/:id [authenticate,<anonymous>,getCategory]',
  'PUT /api/v1/catalog/categories/:id [authenticate,<anonymous>,updateCategory]',
  'PATCH /api/v1/catalog/categories/:id/activate [authenticate,<anonymous>,activateCategory]',
  'PATCH /api/v1/catalog/categories/:id/deactivate [authenticate,<anonymous>,deactivateCategory]',
  'PATCH /api/v1/sites/:id/rules [configureSiteRules]',
  'PUT /api/v1/sites/:id/rules [configureSiteRules]',
  'PATCH /api/v1/sites/:id/reglas [configureSiteRules]',
  'PUT /api/v1/sites/:id/reglas [configureSiteRules]',
  'GET /api/v1/sites/:id/rules [getSiteRulesForAlly]',
  'GET /api/v1/sites/:id/reglas [getSiteRulesForAlly]',
  'POST /api/v1/sites/:id/validate-schedule [validateAllySchedule]',
  'GET /api/v1/legal/documents/active [getActiveDocuments]',
  'POST /api/v1/legal/consents [authenticate,registerConsent]',
  'POST /api/v1/clients/company [registerCompany]',
  'POST /api/v1/clients/:id/sites [addSite]',
  'GET /api/v1/clients/:id/sites [getSites]',
  'PATCH /api/v1/clients/:id/sites/:siteId [updateSite]',
  'POST /api/v1/allies/employees [authenticate,<anonymous>,registerDirectEmployee]',
  'POST /api/v1/allies/direct-employees [authenticate,<anonymous>,registerDirectEmployee]',
  'POST /api/v1/admin/employees [authenticate,<anonymous>,registerDirectEmployee]',
  '_ALL /auth/validate-token [<anonymous>]',
  'POST /auth/dev-token [<anonymous>]',
  'POST /auth/register/ally [multerMiddleware,registerAllyNaturalPerson]',
  'POST /auth/register/ally/company [multerMiddleware,registerAllyCompany]',
  'POST /auth/register/client [registerClientNaturalPerson]',
  'POST /auth/register/client/company [registerClientCompany]',
  'GET /tenants [listTenants]',
  'GET /profiles/me [getOwnProfile]',
  'PATCH /profiles/me [updateOwnProfile]',
  'POST /profiles/me/photo [multerMiddleware,updateOwnProfilePhoto]',
  'GET /profiles/me/categories [getAllyCategories]',
  'GET /profiles/me/categories/available [listAvailableAllyCategories]',
  'PUT /profiles/me/categories [declareAllyCategories]',
  'POST /profiles/me/categories [declareAllyCategories]',
  'GET /profiles/me/unavailability [listAbsences]',
  'POST /profiles/me/unavailability [createAbsence]',
  'PATCH /profiles/me/unavailability/:absenceId [updateAbsence]',
  'DELETE /profiles/me/unavailability/:absenceId [deleteAbsence]',
  'GET /aliados/verificacion [listAlliesVerification]',
  'GET /aliados/:id/verificacion [getAllyVerificationDetail]',
  'PATCH /aliados/:id/verificacion [resolveAllyVerification]',
  'GET /aliados/:id/documentos/:documentoId/url [getKycDocumentSignedUrl]',
  'GET /allies/eligible [authenticate,listEligibleAllies]',
  'GET /allies/me [authenticate,getOwnAllyProfile]',
  'GET /solicitudes/:id/context [authenticate,getSolicitudContext]',
  'POST /notifications [authenticate,publishNotification]',
  'GET /notifications [authenticate,listNotifications]',
  'GET /profiles/me/inbox [authenticate,listMyInbox]',
  'POST /solicitudes [authenticate,multerMiddleware,createRequest]',
  'GET /catalog [listCategories]',
  'GET /catalog/categories [authenticate,<anonymous>,listCategoriesForTenant]',
  'POST /catalog/categories [authenticate,<anonymous>,createCategory]',
  'GET /catalog/categories/:id [authenticate,<anonymous>,getCategory]',
  'PUT /catalog/categories/:id [authenticate,<anonymous>,updateCategory]',
  'PATCH /catalog/categories/:id/activate [authenticate,<anonymous>,activateCategory]',
  'PATCH /catalog/categories/:id/deactivate [authenticate,<anonymous>,deactivateCategory]',
  'PATCH /sites/:id/rules [configureSiteRules]',
  'PUT /sites/:id/rules [configureSiteRules]',
  'PATCH /sites/:id/reglas [configureSiteRules]',
  'PUT /sites/:id/reglas [configureSiteRules]',
  'GET /sites/:id/rules [getSiteRulesForAlly]',
  'GET /sites/:id/reglas [getSiteRulesForAlly]',
  'POST /sites/:id/validate-schedule [validateAllySchedule]',
  'GET /legal/documents/active [getActiveDocuments]',
  'POST /legal/consents [authenticate,registerConsent]',
  'POST /clients/company [registerCompany]',
  'POST /clients/:id/sites [addSite]',
  'GET /clients/:id/sites [getSites]',
  'PATCH /clients/:id/sites/:siteId [updateSite]',
  'POST /allies/employees [authenticate,<anonymous>,registerDirectEmployee]',
  'POST /allies/direct-employees [authenticate,<anonymous>,registerDirectEmployee]',
  'POST /admin/employees [authenticate,<anonymous>,registerDirectEmployee]',
];

// Express 4 compila el prefijo de router.use() a una regex como /^\/api\/v1\/?(?=\/|$)/i.
function prefijo(layer) {
  const fuente = layer.regexp.source;
  if (fuente === '^\\/?(?=\\/|$)') return '';
  return fuente.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').split('\\/').join('/');
}

function inventario(stack, base = '', out = []) {
  for (const layer of stack) {
    if (layer.route) {
      const cadena = layer.route.stack.map((s) => s.name || 'anon').join(',');
      for (const metodo of Object.keys(layer.route.methods)) {
        out.push(`${metodo.toUpperCase()} ${base}${layer.route.path} [${cadena}]`);
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      inventario(layer.handle.stack, base + prefijo(layer), out);
    }
  }
  return out;
}

test('SCRUM-1447: las rutas previas siguen registradas con el mismo método y los mismos middlewares', () => {
  const actuales = new Set(inventario(app._router.stack));
  const faltantes = RUTAS_PREVIAS.filter((r) => !actuales.has(r));
  assert.deepEqual(faltantes, []);
});

test('SCRUM-1447: ninguna ruta queda registrada dos veces', () => {
  const actuales = inventario(app._router.stack);
  const repetidas = actuales.filter((r, i) => actuales.indexOf(r) !== i);
  assert.deepEqual(repetidas, []);
});
