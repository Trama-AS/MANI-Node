const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');

// SCRUM-1447: regresión de la modularización interna de Core. Toda ruta registrada en `develop` antes de agrupar
// core.routes.js por dominio debe seguir registrada con el mismo método y la misma cadena de middlewares
// (autenticación y rol incluidos). Una ruta nueva no rompe la prueba; quitar o desproteger una sí.
// La lista está en el orden de registro de `develop` (corte 12e1e75, 27-oct-2026): la última prueba la usa para
// comprobar que dos rutas que pueden atender la misma URL conservan su orden relativo.
const RUTAS_PREVIAS = [
  'GET /health [getHealth]',
  '_ALL /api/v1/auth/validate-token [<anonymous>]',
  'POST /api/v1/auth/dev-token [<anonymous>]',
  'POST /api/v1/auth/register/ally [multerMiddleware,registerAllyNaturalPerson]',
  'POST /api/v1/auth/register/ally/company [multerMiddleware,registerAllyCompany]',
  'POST /api/v1/auth/register/client [registerClientNaturalPerson]',
  'POST /api/v1/auth/register/client/company [registerClientCompany]',
  'POST /api/v1/auth/logout [authenticate,logout]',
  'POST /api/v1/auth/password-recovery [requestPasswordRecovery]',
  'POST /api/v1/auth/password-reset [resetPassword]',
  'GET /api/v1/tenants [authenticate,<anonymous>,listTenants]',
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
  'GET /api/v1/allies/me/offers [authenticate,listOwnOffers]',
  'GET /api/v1/solicitudes/me [authenticate,listOwnRequests]',
  'GET /api/v1/solicitudes/me/:id [authenticate,getOwnRequest]',
  'PATCH /api/v1/solicitudes/me/:id/cancelar [authenticate,cancelOwnRequest]',
  'GET /api/v1/solicitudes/:id/context [authenticate,getSolicitudContext]',
  'POST /api/v1/solicitudes/:id/asignacion [authenticate,assignRequest]',
  'POST /api/v1/notifications [authenticate,publishNotification]',
  'GET /api/v1/notifications [authenticate,listNotifications]',
  'GET /api/v1/profiles/me/inbox [authenticate,listMyInbox]',
  'POST /api/v1/solicitudes [authenticate,multerMiddleware,createRequest]',
  'POST /api/v1/solicitudes/:id/cotizaciones [authenticate,createQuote]',
  'GET /api/v1/solicitudes/:id/cotizaciones [authenticate,listQuotes]',
  'POST /api/v1/cotizaciones/:id/aceptar [authenticate,<anonymous>]',
  'POST /api/v1/cotizaciones/:id/rechazar [authenticate,<anonymous>]',
  'POST /api/v1/cotizaciones/:id/ajustar [authenticate,<anonymous>]',
  'POST /api/v1/pagos [authenticate,createPayment]',
  'GET /api/v1/pagos/:id [authenticate,getPayment]',
  'GET /api/v1/pagos/:id/comprobante [authenticate,getReceipt]',
  'POST /api/v1/solicitudes/:id/iniciar [authenticate,<anonymous>]',
  'POST /api/v1/solicitudes/:id/finalizar [authenticate,<anonymous>]',
  'GET /api/v1/solicitudes/:id/ejecucion [authenticate,getExecution]',
  'POST /api/v1/solicitudes/:id/eventos [authenticate,multerMiddleware,registerEvent]',
  'GET /api/v1/solicitudes/:id/eventos [authenticate,listEvents]',
  'GET /api/v1/solicitudes/:id/eventos/:eventoId/evidencia [authenticate,getEventEvidence]',
  'GET /api/v1/catalog [listCategories]',
  'GET /api/v1/catalog/categories [authenticate,<anonymous>,listCategoriesForTenant]',
  'POST /api/v1/catalog/categories [authenticate,<anonymous>,createCategory]',
  'GET /api/v1/catalog/categories/:id [authenticate,<anonymous>,getCategory]',
  'PUT /api/v1/catalog/categories/:id [authenticate,<anonymous>,updateCategory]',
  'PATCH /api/v1/catalog/categories/:id/activate [authenticate,<anonymous>,activateCategory]',
  'PATCH /api/v1/catalog/categories/:id/deactivate [authenticate,<anonymous>,deactivateCategory]',
  'GET /api/v1/catalog/zones [authenticate,listZoneCatalog]',
  'GET /api/v1/catalog/zones/:id [authenticate,getZone]',
  'POST /api/v1/solicitudes/:id/mensajes [authenticate,sendMessage]',
  'GET /api/v1/solicitudes/:id/mensajes [authenticate,listMessages]',
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
  'POST /api/v1/allies/employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
  'POST /api/v1/allies/direct-employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
  'POST /api/v1/admin/employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
  '_ALL /auth/validate-token [<anonymous>]',
  'POST /auth/dev-token [<anonymous>]',
  'POST /auth/register/ally [multerMiddleware,registerAllyNaturalPerson]',
  'POST /auth/register/ally/company [multerMiddleware,registerAllyCompany]',
  'POST /auth/register/client [registerClientNaturalPerson]',
  'POST /auth/register/client/company [registerClientCompany]',
  'POST /auth/logout [authenticate,logout]',
  'POST /auth/password-recovery [requestPasswordRecovery]',
  'POST /auth/password-reset [resetPassword]',
  'GET /tenants [authenticate,<anonymous>,listTenants]',
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
  'GET /allies/me/offers [authenticate,listOwnOffers]',
  'GET /solicitudes/me [authenticate,listOwnRequests]',
  'GET /solicitudes/me/:id [authenticate,getOwnRequest]',
  'PATCH /solicitudes/me/:id/cancelar [authenticate,cancelOwnRequest]',
  'GET /solicitudes/:id/context [authenticate,getSolicitudContext]',
  'POST /solicitudes/:id/asignacion [authenticate,assignRequest]',
  'POST /notifications [authenticate,publishNotification]',
  'GET /notifications [authenticate,listNotifications]',
  'GET /profiles/me/inbox [authenticate,listMyInbox]',
  'POST /solicitudes [authenticate,multerMiddleware,createRequest]',
  'POST /solicitudes/:id/cotizaciones [authenticate,createQuote]',
  'GET /solicitudes/:id/cotizaciones [authenticate,listQuotes]',
  'POST /cotizaciones/:id/aceptar [authenticate,<anonymous>]',
  'POST /cotizaciones/:id/rechazar [authenticate,<anonymous>]',
  'POST /cotizaciones/:id/ajustar [authenticate,<anonymous>]',
  'POST /pagos [authenticate,createPayment]',
  'GET /pagos/:id [authenticate,getPayment]',
  'GET /pagos/:id/comprobante [authenticate,getReceipt]',
  'POST /solicitudes/:id/iniciar [authenticate,<anonymous>]',
  'POST /solicitudes/:id/finalizar [authenticate,<anonymous>]',
  'GET /solicitudes/:id/ejecucion [authenticate,getExecution]',
  'POST /solicitudes/:id/eventos [authenticate,multerMiddleware,registerEvent]',
  'GET /solicitudes/:id/eventos [authenticate,listEvents]',
  'GET /solicitudes/:id/eventos/:eventoId/evidencia [authenticate,getEventEvidence]',
  'GET /catalog [listCategories]',
  'GET /catalog/categories [authenticate,<anonymous>,listCategoriesForTenant]',
  'POST /catalog/categories [authenticate,<anonymous>,createCategory]',
  'GET /catalog/categories/:id [authenticate,<anonymous>,getCategory]',
  'PUT /catalog/categories/:id [authenticate,<anonymous>,updateCategory]',
  'PATCH /catalog/categories/:id/activate [authenticate,<anonymous>,activateCategory]',
  'PATCH /catalog/categories/:id/deactivate [authenticate,<anonymous>,deactivateCategory]',
  'GET /catalog/zones [authenticate,listZoneCatalog]',
  'GET /catalog/zones/:id [authenticate,getZone]',
  'POST /solicitudes/:id/mensajes [authenticate,sendMessage]',
  'GET /solicitudes/:id/mensajes [authenticate,listMessages]',
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
  'POST /allies/employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
  'POST /allies/direct-employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
  'POST /admin/employees [authenticate,<anonymous>,recibirDocumento,registerDirectEmployee]',
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

// Dos rutas compiten por una URL si tienen el mismo método (o una es `_ALL`), el mismo número de segmentos y en cada
// posición el mismo literal o un parámetro. Ejemplo: GET /solicitudes/me/:id y GET /solicitudes/:id/context atienden
// las dos `/solicitudes/me/context`; gana la que Express registró primero.
function segmentos(ruta) {
  const [metodo, resto] = [ruta.slice(0, ruta.indexOf(' ')), ruta.slice(ruta.indexOf(' ') + 1)];
  return { metodo, partes: resto.split(' [')[0].split('/').filter(Boolean) };
}

function compiten(a, b) {
  const x = segmentos(a);
  const y = segmentos(b);
  if (x.metodo !== y.metodo && x.metodo !== '_ALL' && y.metodo !== '_ALL') return false;
  if (x.partes.length !== y.partes.length) return false;
  return x.partes.every((p, i) => p === y.partes[i] || p.startsWith(':') || y.partes[i].startsWith(':'));
}

test('SCRUM-1447: las rutas que compiten por la misma URL conservan el orden relativo que tenían', () => {
  const actuales = inventario(app._router.stack);
  const invertidas = [];
  for (let i = 0; i < RUTAS_PREVIAS.length; i += 1) {
    for (let j = i + 1; j < RUTAS_PREVIAS.length; j += 1) {
      if (compiten(RUTAS_PREVIAS[i], RUTAS_PREVIAS[j])
        && actuales.indexOf(RUTAS_PREVIAS[i]) > actuales.indexOf(RUTAS_PREVIAS[j])) {
        invertidas.push(`${RUTAS_PREVIAS[i]} <-> ${RUTAS_PREVIAS[j]}`);
      }
    }
  }
  assert.deepEqual(invertidas, []);
});
