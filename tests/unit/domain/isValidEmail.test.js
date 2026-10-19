const test = require('node:test');
const assert = require('node:assert/strict');
const isValidEmail = require('../../../src/domain/validation/isValidEmail');

test('acepta correos con formato válido', () => {
  for (const email of ['cliente@mani.test', 'a@b.c', 'nombre.apellido@sub.dominio.co', 'a@b..c', 'a@b.c.']) {
    assert.equal(isValidEmail(email), true, email);
  }
});

test('rechaza valores que no son texto', () => {
  for (const email of [undefined, null, 123, {}, ['a@b.c']]) {
    assert.equal(isValidEmail(email), false, String(email));
  }
});

test('rechaza correos con espacios', () => {
  for (const email of ['a b@c.d', 'a@c .d', ' a@b.c', 'a@b.c\n']) {
    assert.equal(isValidEmail(email), false, JSON.stringify(email));
  }
});

test('rechaza correos sin arroba, con varias o sin texto antes de ella', () => {
  for (const email of ['no-es-un-email', 'a@b@c.d', '@b.c', '']) {
    assert.equal(isValidEmail(email), false, email);
  }
});

test('rechaza dominios sin un punto con texto a ambos lados', () => {
  for (const email of ['a@bc', 'a@.bc', 'a@bc.', 'a@.', 'a@', 'a@b']) {
    assert.equal(isValidEmail(email), false, email);
  }
});
