const test = require('node:test');
const assert = require('node:assert/strict');

const Tenant = require('../../../src/domain/entities/Tenant');
const Profile = require('../../../src/domain/entities/Profile');
const Category = require('../../../src/domain/entities/Category');
const DirectEmployee = require('../../../src/domain/entities/DirectEmployee');
const { ValidationError, NotFoundError } = require('../../../src/domain/errors/DomainError');

test('Domain Entity: DirectEmployee valida campos y entra como VERIFICADO', () => {
  assert.throws(() => new DirectEmployee({ tenantId: '', fullName: 'Carlos', email: 'c@m.co' }), ValidationError);
  assert.throws(() => new DirectEmployee({ tenantId: 't-1', fullName: 'C', email: 'c@m.co' }), ValidationError);
  assert.throws(() => new DirectEmployee({ tenantId: 't-1', fullName: 'Carlos', email: 'invalido' }), ValidationError);

  const emp = new DirectEmployee({
    id: 'emp-1',
    usuarioId: 'u-1',
    tenantId: 't-1',
    fullName: 'Carlos Gomez',
    email: 'carlos@empresa.com',
  });
  assert.equal(emp.isDirectEmployee(), true);
  assert.equal(emp.isVerified(), true);
  assert.equal(emp.toJSON().tipoAliado, 'EMPLEADO_DIRECTO');
  assert.equal(emp.toJSON().estadoVerificacion, 'VERIFICADO');
});

test('Domain Entity: Tenant valida campos obligatorios y status', () => {
  assert.throws(() => new Tenant({ id: '', name: 'Test' }), ValidationError);
  assert.throws(() => new Tenant({ id: 't-1', name: '' }), ValidationError);

  const tenant = new Tenant({ id: 't-1', name: 'Tenant 1', status: 'ACTIVE' });
  assert.equal(tenant.isActive(), true);
  assert.deepEqual(tenant.toJSON(), { id: 't-1', slug: 't-1', name: 'Tenant 1', status: 'ACTIVE' });

  const customTenant = new Tenant({ id: 't-2', slug: 'slug-especial', name: 'Tenant 2', status: 'ACTIVE' });
  assert.equal(customTenant.slug, 'slug-especial');
});

test('Domain Entity: Profile valida roles y estados de dominio', () => {
  assert.throws(() => new Profile({ id: 'u-1', fullName: 'Juan', role: 'INVALID_ROLE' }), ValidationError);
  assert.throws(() => new Profile({ id: '', fullName: 'Juan' }), ValidationError);

  const profile = new Profile({
    id: 'u-1',
    role: 'CLIENT',
    fullName: 'Juan Perez',
    status: 'VERIFIED',
  });
  assert.equal(profile.isVerified(), true);
  assert.equal(profile.role, 'CLIENT');
});

test('Domain Entity: Category valida identificador y activo', () => {
  assert.throws(() => new Category({ id: '', name: 'Manicura', flujoOperativo: 'TARIFA_ESTANDAR' }), ValidationError);

  const category = new Category({ id: 'c-1', name: 'Acrílicas', active: true, flujoOperativo: 'TARIFA_ESTANDAR' });
  assert.equal(category.isActive(), true);
  assert.equal(category.toJSON().name, 'Acrílicas');
});

test('Category.assertValidName: reglas del nombre para datos nuevos (3-60 caracteres, al menos una letra)', () => {
  assert.throws(() => Category.assertValidName('AB'), ValidationError); // < 3
  assert.throws(() => Category.assertValidName('A'.repeat(61)), ValidationError); // > 60
  assert.throws(() => Category.assertValidName('123456'), ValidationError); // sin letras
  assert.throws(() => Category.assertValidName(''), ValidationError);
  assert.throws(() => Category.assertValidName(undefined), ValidationError);

  // Colapsa espacios internos repetidos, igual que crear_categoria_servicio().
  assert.equal(Category.assertValidName('  Uñas   Acrílicas  '), 'Uñas Acrílicas');
});

test('Category.assertValidFlujoOperativo: obligatorio y en COTIZACION_PREVIA | TARIFA_ESTANDAR', () => {
  assert.throws(() => Category.assertValidFlujoOperativo('OTRO'), ValidationError);
  assert.throws(() => Category.assertValidFlujoOperativo(undefined), ValidationError); // sin default
  assert.equal(Category.assertValidFlujoOperativo('COTIZACION_PREVIA'), 'COTIZACION_PREVIA');
});

test('Domain Entity: Category rehidrata filas históricas sin aplicar reglas de negocio', () => {
  // Seed QA: flujo_operativo NULL (ck_categoria_flujo es NOT VALID).
  const sinFlujo = new Category({ id: 'c-1', name: 'Plomeria', tenantId: 't1', flujoOperativo: null });
  assert.equal(sinFlujo.flujoOperativo, null);

  // Fila que solo trae id, nombre y estado (p. ej. una consulta parcial).
  assert.equal(new Category({ id: 'c-2', name: 'Electricidad', active: true }).flujoOperativo, null);

  // Nombre fuera de las reglas actuales: no debe romper el listado completo.
  assert.equal(new Category({ id: 'c-3', name: 'AB', flujoOperativo: 'TARIFA_ESTANDAR' }).name, 'AB');
  assert.equal(new Category({ id: 'c-4', name: '  Uñas   Gel ' }).name, 'Uñas Gel');

  // La forma mínima sí se exige.
  assert.throws(() => new Category({ id: 'c-5', name: '   ' }), ValidationError);
});

test('Domain Errors tienen códigos de error y statusCodes adecuados', () => {
  const notFound = new NotFoundError('No encontrado');
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.code, 'NOT_FOUND');

  const validation = new ValidationError('Dato inválido');
  assert.equal(validation.statusCode, 400);
  assert.equal(validation.code, 'VALIDATION_ERROR');
});

