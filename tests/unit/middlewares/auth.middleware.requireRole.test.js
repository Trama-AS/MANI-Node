const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('../../../src/middlewares/auth.middleware');

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

test('requireRole deja pasar cuando req.user.role está en la lista permitida', () => {
  const middleware = requireRole('ADMIN');
  const req = { user: { role: 'ADMIN' } };
  const res = mockRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('requireRole responde 403 FORBIDDEN cuando el rol no está permitido', () => {
  const middleware = requireRole('ADMIN');
  const req = { user: { role: 'CLIENT' } };
  const res = mockRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

// requireRole es el de develop (SCRUM-850): sin sesión responde 401, no 403.
test('requireRole responde 401 cuando no hay req.user (no debería pasar si va después de authenticate)', () => {
  const middleware = requireRole('ADMIN');
  const req = {};
  const res = mockRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireRole("ADMIN") acepta también ADMIN_TENANT, el valor del claim en BD', () => {
  const middleware = requireRole('ADMIN');
  let nextCalled = false;
  middleware({ user: { role: 'ADMIN_TENANT' } }, mockRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('requireRole acepta múltiples roles permitidos', () => {
  const middleware = requireRole('ADMIN', 'ALLY');
  const req = { user: { role: 'ALLY' } };
  const res = mockRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
