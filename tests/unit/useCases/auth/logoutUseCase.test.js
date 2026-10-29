const test = require('node:test');
const assert = require('node:assert/strict');
const LogoutUseCase = require('../../../../src/application/useCases/auth/LogoutUseCase');

const FIXED = new Date('2026-10-26T20:00:00.000Z');
const session = { userId: 'u-1', tenantId: 't-1', role: 'CLIENT', email: 'ana@mani.test', token: 'secreto' };

test('registra quién cerró sesión, en qué tenant y cuándo, tomados de la sesión verificada', () => {
  const audit = [];
  const result = new LogoutUseCase({ auditLogger: (e) => audit.push(e), now: () => FIXED }).execute({ session, correlationId: 'c-1' });

  assert.deepEqual(result, { loggedOut: true });
  assert.deepEqual(audit, [
    { event: 'US-02.sesion.cierre', tenant_id: 't-1', usuario_id: 'u-1', rol: 'CLIENT', fecha: FIXED.toISOString(), correlation_id: 'c-1' },
  ]);
});

test('la auditoría no lleva correo ni token', () => {
  const audit = [];
  new LogoutUseCase({ auditLogger: (e) => audit.push(e) }).execute({ session });
  const text = JSON.stringify(audit);
  assert.equal(text.includes('ana@mani.test'), false);
  assert.equal(text.includes('secreto'), false);
});

test('sin sesión (usuario o tenant) responde 401 y no audita', () => {
  const audit = [];
  const useCase = new LogoutUseCase({ auditLogger: (e) => audit.push(e) });
  for (const s of [undefined, {}, { userId: 'u-1' }, { tenantId: 't-1' }]) {
    assert.throws(() => useCase.execute({ session: s }), (e) => e.statusCode === 401);
  }
  assert.deepEqual(audit, []);
});
