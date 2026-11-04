const { Router } = require('express');
const tariffsController = require('../../controllers/tariffs.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Tarifario (M-10). El rol lo decide el caso de uso: la referencia de una solicitud la ven cliente y aliado.
const router = Router();

// SCRUM-885: el administrador del tenant carga, edita (versión nueva), consulta y ve el historial.
router.get('/tarifas', authenticate, tariffsController.listTariffs);
router.post('/tarifas', authenticate, tariffsController.createTariff);
router.put('/tarifas/:id', authenticate, tariffsController.updateTariff);
router.get('/tarifas/categorias/:categoriaId/historial', authenticate, tariffsController.getTariffHistory);
// SCRUM-886: tarifa vigente de la categoría de la solicitud, para el cliente dueño y el aliado asignado.
router.get('/solicitudes/:id/tarifa-referencia', authenticate, tariffsController.getRequestReferenceTariff);
// SCRUM-887: cotizaciones del periodo que Rules evaluó fuera del rango de su tarifa.
router.get('/reportes/cotizaciones-fuera-de-rango', authenticate, tariffsController.getOutOfRangeQuotesReport);

module.exports = router;
