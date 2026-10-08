const test = require('node:test');
const assert = require('node:assert/strict');

const Tenant = require('../../../src/domain/entities/Tenant');
const Profile = require('../../../src/domain/entities/Profile');
const Category = require('../../../src/domain/entities/Category');
const { ValidationError, NotFoundError } = require('../../../src/domain/errors/DomainError');

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

test('Domain Entity: Category valida el nombre (3-60 caracteres, al menos una letra)', () => {
  const base = { id: 'c-1', flujoOperativo: 'TARIFA_ESTANDAR' };

  assert.throws(() => new Category({ ...base, name: 'AB' }), ValidationError); // < 3
  assert.throws(() => new Category({ ...base, name: 'A'.repeat(61) }), ValidationError); // > 60
  assert.throws(() => new Category({ ...base, name: '123456' }), ValidationError); // sin letras
  assert.throws(() => new Category({ ...base, name: '' }), ValidationError);

  // Colapsa espacios internos repetidos, igual que crear_categoria_servicio().
  const category = new Category({ ...base, name: '  Uñas   Acrílicas  ' });
  assert.equal(category.name, 'Uñas Acrílicas');
});

test('Domain Entity: Category valida flujoOperativo (COTIZACION_PREVIA | TARIFA_ESTANDAR)', () => {
  assert.throws(
    () => new Category({ id: 'c-1', name: 'Manicura', flujoOperativo: 'OTRO' }),
    ValidationError
  );
  assert.throws(() => new Category({ id: 'c-1', name: 'Manicura' }), ValidationError); // sin default

  const cotizacion = new Category({ id: 'c-1', name: 'Plomería', flujoOperativo: 'COTIZACION_PREVIA' });
  assert.equal(cotizacion.toJSON().flujoOperativo, 'COTIZACION_PREVIA');
});

test('Domain Errors tienen códigos de error y statusCodes adecuados', () => {
  const notFound = new NotFoundError('No encontrado');
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.code, 'NOT_FOUND');

  const validation = new ValidationError('Dato inválido');
  assert.equal(validation.statusCode, 400);
  assert.equal(validation.code, 'VALIDATION_ERROR');
});

