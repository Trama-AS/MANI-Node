const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../../../src/middlewares/errorHandler.middleware');
const {
  DomainError,
  ValidationError,
  NotFoundError,
  RuleViolationError,
} = require('../../../src/domain/errors/DomainError');

// Respuesta de Express mínima: guarda el estado y el cuerpo para afirmarlos.
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const req = { correlationId: 'corr-1' };

// T9 (fallo cerrado): el detalle interno no sale en la respuesta. QA encontró
// en SCRUM-1391 que un id no-UUID devolvía 500 con el texto de PostgreSQL;
// aunque ese caso ahora se valida antes, el manejador no debe filtrar el
// mensaje de ninguna falla no prevista.
test('errorHandler no revela el detalle interno de un error sin statusCode: 500 con mensaje fijo', () => {
  const res = fakeRes();
  const pgError = new Error('invalid input syntax for type uuid: "abc"');
  pgError.code = '22P02';
  pgError.table = 'categoria_servicio';

  errorHandler(pgError, req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Error interno del servidor');
  assert.equal(res.body.code, 'INTERNAL_ERROR');
  assert.equal(res.body.correlationId, 'corr-1');
  assert.ok(!/invalid input syntax|uuid|categoria_servicio|22P02/i.test(JSON.stringify(res.body)));
});

test('errorHandler conserva el mensaje y el código de los errores de dominio', () => {
  for (const [err, status] of [
    [new ValidationError('MANI-CAT-400: categoryId debe ser un UUID válido', 'MANI-CAT-400'), 400],
    [new NotFoundError('No se encontró la categoría', 'CATEGORY_NOT_FOUND'), 404],
  ]) {
    const res = fakeRes();
    errorHandler(err, req, res, () => {});
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error, err.message);
    assert.equal(res.body.code, err.code);
  }
});

test('errorHandler mantiene las violaciones de Rules en un 400 y las omite en un 500', () => {
  const conViolaciones = fakeRes();
  errorHandler(new RuleViolationError([{ rule: 'nombre', detail: 'muy corto' }]), req, conViolaciones, () => {});
  assert.equal(conViolaciones.statusCode, 400);
  assert.deepEqual(conViolaciones.body.violations, [{ rule: 'nombre', detail: 'muy corto' }]);

  const interno = fakeRes();
  const err = new Error('fallo de infraestructura');
  err.violations = [{ rule: 'interna', detail: 'no debe salir' }];
  errorHandler(err, req, interno, () => {});
  assert.equal(interno.statusCode, 500);
  assert.equal(interno.body.violations, undefined);
});

test('errorHandler traduce un MulterError a 400 VALIDATION_ERROR sin exponer su código propio', () => {
  const res = fakeRes();
  const multer = new Error('Unexpected field');
  multer.name = 'MulterError';
  multer.code = 'LIMIT_UNEXPECTED_FILE';

  errorHandler(multer, req, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.error, 'Unexpected field');
});

test('errorHandler responde con correlationId none cuando la petición no lo trae', () => {
  const res = fakeRes();
  errorHandler(new ValidationError('dato inválido'), {}, res, () => {});
  assert.equal(res.body.correlationId, 'none');
});

// Un 503 o un 504 de dominio sí conservan su mensaje: están escritos para el
// cliente y hay pruebas de contrato que los afirman (Rules no disponible,
// timeout del proveedor). Lo que decide no es el código HTTP, sino si el
// error estaba previsto.
test('errorHandler conserva el mensaje de un 503 y un 504 de dominio', () => {
  for (const [err, status] of [
    [new DomainError('El servicio de reglas no está disponible', 'RULES_SERVICE_UNAVAILABLE', 503), 503],
    [new DomainError('El proveedor no respondió a tiempo', 'PROVIDER_TIMEOUT', 504), 504],
  ]) {
    const res = fakeRes();
    errorHandler(err, req, res, () => {});
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error, err.message);
    assert.equal(res.body.code, err.code);
  }
});
