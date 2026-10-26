const test = require('node:test');
const assert = require('node:assert/strict');
const RequestPasswordRecoveryUseCase = require('../../../../src/application/useCases/auth/RequestPasswordRecoveryUseCase');
const ResetPasswordUseCase = require('../../../../src/application/useCases/auth/ResetPasswordUseCase');

const tenant = { id: 'tenant-1', isActive: () => true };
const tenantInactivo = { id: 'tenant-2', isActive: () => false };

function setup({ usuario = { id: 'u-1', estado: 'ACTIVO' }, tokenOwner = 'u-1', tokenError = null } = {}) {
  const calls = { recovery: [], update: [], audit: [], lookups: [] };
  const deps = {
    tenantRepository: { findBySlug: async (slug) => (slug === 'acme' ? tenant : slug === 'inactivo' ? tenantInactivo : null) },
    usuarioRepository: {
      findByEmail: async (...a) => (calls.lookups.push(['email', ...a]), usuario),
      findById: async (...a) => (calls.lookups.push(['id', ...a]), usuario && usuario.id === a[1] ? usuario : null),
    },
    authIdentityService: {
      requestPasswordRecovery: async (p) => calls.recovery.push(p),
      resolveRecoveryUser: async () => {
        if (tokenError) throw tokenError;
        return { userId: tokenOwner };
      },
      updatePassword: async (...a) => calls.update.push(a),
    },
    auditLogger: (entry) => calls.audit.push(entry),
  };
  return { deps, calls };
}

// ---- solicitud ----

test('solicitud: con cuenta activa pide el correo al proveedor con el redirectTo configurado', async () => {
  const { deps, calls } = setup();
  const result = await new RequestPasswordRecoveryUseCase({ ...deps, redirectTo: 'https://app/reset' }).execute({
    tenantSlug: 'acme',
    email: ' ana@mani.test ',
    correlationId: 'c-1',
  });

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls.recovery, [{ email: 'ana@mani.test', redirectTo: 'https://app/reset' }]);
  assert.deepEqual(calls.lookups[0], ['email', 'tenant-1', 'ana@mani.test']);
});

test('solicitud: sin cuenta, o con cuenta inactiva, responde igual y no envía correo', async () => {
  for (const usuario of [null, { id: 'u-9', estado: 'INACTIVO' }]) {
    const { deps, calls } = setup({ usuario });
    const result = await new RequestPasswordRecoveryUseCase(deps).execute({ tenantSlug: 'acme', email: 'x@mani.test' });
    assert.deepEqual(result, { accepted: true });
    assert.equal(calls.recovery.length, 0);
  }
});

test('solicitud: acepta el estado ACTIVE de DEV y ACTIVO de la base', async () => {
  for (const estado of ['ACTIVE', 'ACTIVO']) {
    const { deps, calls } = setup({ usuario: { id: 'u-1', estado } });
    await new RequestPasswordRecoveryUseCase(deps).execute({ tenantSlug: 'acme', email: 'x@mani.test' });
    assert.equal(calls.recovery.length, 1);
  }
});

test('solicitud: la auditoría no lleva el correo y marca si salió el mensaje', async () => {
  const { deps, calls } = setup();
  await new RequestPasswordRecoveryUseCase(deps).execute({ tenantSlug: 'acme', email: 'ana@mani.test', correlationId: 'c-1' });
  const { deps: d2, calls: c2 } = setup({ usuario: null });
  await new RequestPasswordRecoveryUseCase(d2).execute({ tenantSlug: 'acme', email: 'ana@mani.test' });

  assert.equal(calls.audit[0].correo_enviado, true);
  assert.equal(calls.audit[0].usuario_id, 'u-1');
  assert.equal(c2.audit[0].usuario_id, null);
  assert.equal(JSON.stringify([...calls.audit, ...c2.audit]).includes('ana@mani.test'), false);
});

test('solicitud: validaciones y tenant inexistente o inactivo', async () => {
  const { deps, calls } = setup();
  const uc = new RequestPasswordRecoveryUseCase(deps);
  await assert.rejects(() => uc.execute({ email: 'a@mani.test' }), (e) => e.code === 'VALIDATION_ERROR');
  for (const email of [undefined, '', 'no-es-correo', 42]) {
    await assert.rejects(() => uc.execute({ tenantSlug: 'acme', email }), (e) => e.code === 'VALIDATION_ERROR' && e.statusCode === 400);
  }
  for (const tenantSlug of ['no-existe', 'inactivo']) {
    await assert.rejects(() => uc.execute({ tenantSlug, email: 'a@mani.test' }), (e) => e.code === 'TENANT_NOT_FOUND');
  }
  assert.equal(calls.recovery.length, 0);
});

test('solicitud: si el proveedor falla el error se propaga (no se oculta como éxito)', async () => {
  const { deps } = setup();
  deps.authIdentityService.requestPasswordRecovery = async () => {
    throw Object.assign(new Error('x'), { statusCode: 429, code: 'RATE_LIMITED' });
  };
  await assert.rejects(() => new RequestPasswordRecoveryUseCase(deps).execute({ tenantSlug: 'acme', email: 'a@mani.test' }), (e) => e.code === 'RATE_LIMITED');
});

// ---- restablecimiento ----

const reset = (uc, over = {}) => uc.execute({ tenantSlug: 'acme', accessToken: 'tok', newPassword: 'ClaveNueva123', correlationId: 'c-2', ...over });

test('restablecer: con token válido de una cuenta activa del tenant cambia la contraseña y audita', async () => {
  const { deps, calls } = setup();
  assert.deepEqual(await reset(new ResetPasswordUseCase(deps)), { reset: true });

  assert.deepEqual(calls.update, [['u-1', 'ClaveNueva123']]);
  assert.deepEqual(calls.lookups[0], ['id', 'tenant-1', 'u-1']);
  assert.equal(calls.audit[0].usuario_id, 'u-1');
  assert.equal(JSON.stringify(calls.audit).includes('ClaveNueva123'), false);
  assert.equal(JSON.stringify(calls.audit).includes('tok'), false);
});

test('restablecer: una cuenta de otro tenant, inexistente o inactiva responde INVALID_RECOVERY_TOKEN y no cambia nada', async () => {
  for (const usuario of [null, { id: 'u-1', estado: 'INACTIVO' }]) {
    const { deps, calls } = setup({ usuario });
    await assert.rejects(() => reset(new ResetPasswordUseCase(deps)), (e) => e.statusCode === 401 && e.code === 'INVALID_RECOVERY_TOKEN');
    assert.equal(calls.update.length, 0);
  }
});

test('restablecer: tenant inexistente o inactivo no revela nada y no consulta el token', async () => {
  for (const tenantSlug of ['no-existe', 'inactivo']) {
    const { deps, calls } = setup();
    await assert.rejects(() => reset(new ResetPasswordUseCase(deps), { tenantSlug }), (e) => e.code === 'INVALID_RECOVERY_TOKEN');
    assert.equal(calls.update.length, 0);
  }
});

test('restablecer: un token inválido del proveedor se propaga y no cambia nada', async () => {
  const err = Object.assign(new Error('x'), { statusCode: 401, code: 'INVALID_RECOVERY_TOKEN' });
  const { deps, calls } = setup({ tokenError: err });
  await assert.rejects(() => reset(new ResetPasswordUseCase(deps)), (e) => e.code === 'INVALID_RECOVERY_TOKEN');
  assert.equal(calls.update.length, 0);
});

test('restablecer: valida slug, token y contraseña (mínimo 8) antes de tocar nada', async () => {
  const { deps, calls } = setup();
  const uc = new ResetPasswordUseCase(deps);
  await assert.rejects(() => reset(uc, { tenantSlug: undefined }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => reset(uc, { accessToken: '' }), (e) => e.code === 'VALIDATION_ERROR');
  for (const newPassword of [undefined, 'corta12', 12345678]) {
    await assert.rejects(() => reset(uc, { newPassword }), (e) => e.code === 'VALIDATION_ERROR' && e.statusCode === 400);
  }
  assert.equal(calls.lookups.length, 0);
  assert.equal(calls.update.length, 0);
});
