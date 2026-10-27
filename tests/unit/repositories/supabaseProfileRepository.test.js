const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseProfileRepository = require('../../../src/infrastructure/repositories/SupabaseProfileRepository');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeClient({ usuario, aliado, usuarioError, aliadoError }) {
  return {
    from: (table) => {
      if (table === 'usuario') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: usuario, error: usuarioError || null }) }),
              maybeSingle: async () => ({ data: usuario, error: usuarioError || null }),
            }),
          }),
        };
      }
      if (table === 'aliado') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: aliado, error: aliadoError || null }) }),
          }),
        };
      }
      throw new Error(`tabla inesperada: ${table}`);
    },
  };
}

test('findByUserId retorna null cuando no hay usuario con ese id/tenant (B4: sin fallback a perfil demo)', async () => {
  const client = makeClient({ usuario: null });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = await repo.findByUserId('user-que-no-existe', 't1');

  assert.equal(profile, null);
});

test('findByUserId de un ALIADO combina usuario + aliado (nombre y estado de verificación)', async () => {
  const client = makeClient({
    usuario: { id: 'u1', tenant_id: 't1', email: 'a@mani.test', rol: 'ALIADO', estado: 'ACTIVO' },
    aliado: { nombre_razon_social: 'María Pérez', estado_verificacion: 'PENDIENTE' },
  });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = await repo.findByUserId('u1', 't1');

  assert.equal(profile.role, 'ALLY');
  assert.equal(profile.fullName, 'María Pérez');
  assert.equal(profile.status, 'PENDING');
  assert.equal(profile.tenantId, 't1');
});

test('findByUserId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeClient({ usuario: null, usuarioError: { message: 'down' } });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByUserId('u1', 't1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

// ---- SCRUM-1377 (HU-M02-09): lo guardado en el perfil se lee al recargar ----

/** Cliente falso que registra las columnas consultadas y las actualizaciones por tabla. */
function recordingClient({ usuario, aliado = null }) {
  const calls = { selects: [], updates: [] };
  const tablaConUpdate = (table) => ({
    select: (cols) => {
      calls.selects.push([table, cols]);
      const row = table === 'usuario' ? usuario : aliado;
      return {
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      };
    },
    update: (values) => {
      calls.updates.push([table, values]);
      const result = { error: null };
      return { eq: () => ({ eq: async () => result, then: (resolve) => resolve(result) }) };
    },
  });
  return { client: { from: tablaConUpdate }, calls };
}

const clienteRow = (extra = {}) => ({ id: 'u1', tenant_id: 't1', email: 'ana@mani.test', rol: 'CLIENTE', estado: 'ACTIVO', ...extra });

test('findByUserId devuelve teléfono, dirección y foto guardados (se ven al recargar)', async () => {
  const { client, calls } = recordingClient({
    usuario: clienteRow({ telefono: '+573001234567', direccion: 'Calle 1 # 2-3', foto_url: 't1/u1/avatar-1.png' }),
  });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = (await repo.findByUserId('u1', 't1')).toJSON();

  assert.equal(profile.phone, '+573001234567');
  assert.equal(profile.address, 'Calle 1 # 2-3');
  assert.equal(profile.photoUrl, 't1/u1/avatar-1.png');
  assert.match(calls.selects[0][1], /telefono, direccion, foto_url/);
});

test('findByUserId omite los campos de perfil que todavía no tienen valor', async () => {
  const { client } = recordingClient({ usuario: clienteRow({ telefono: null, direccion: null, foto_url: null }) });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = (await repo.findByUserId('u1', 't1')).toJSON();

  assert.equal('phone' in profile, false);
  assert.equal('address' in profile, false);
  assert.equal('photoUrl' in profile, false);
});

test('updateOwnProfile escribe teléfono, dirección y foto en usuario y los devuelve', async () => {
  const { client, calls } = recordingClient({ usuario: clienteRow() });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const updated = (await repo.updateOwnProfile('u1', 't1', { phone: '+573001234567', address: 'Calle 1 # 2-3', photoUrl: 't1/u1/a.png' })).toJSON();

  assert.deepEqual(calls.updates, [['usuario', { telefono: '+573001234567', direccion: 'Calle 1 # 2-3', foto_url: 't1/u1/a.png' }]]);
  assert.equal(updated.phone, '+573001234567');
  assert.equal(updated.address, 'Calle 1 # 2-3');
  assert.equal(updated.photoUrl, 't1/u1/a.png');
});

test('updateOwnProfile de un aliado guarda el nombre en aliado', async () => {
  const { client, calls } = recordingClient({
    usuario: clienteRow({ rol: 'ALIADO' }),
    aliado: { nombre_razon_social: 'María Pérez', estado_verificacion: 'VERIFICADO' },
  });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const updated = await repo.updateOwnProfile('u1', 't1', { fullName: 'María P. Gómez' });

  assert.deepEqual(calls.updates, [['aliado', { nombre_razon_social: 'María P. Gómez' }]]);
  assert.equal(updated.fullName, 'María P. Gómez');
});

test('updateOwnProfile de un cliente no afirma un nombre que no se guarda (usuario no tiene columna de nombre)', async () => {
  const { client, calls } = recordingClient({ usuario: clienteRow() });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const updated = await repo.updateOwnProfile('u1', 't1', { fullName: 'Nombre Nuevo', phone: '+573001234567' });

  assert.deepEqual(calls.updates, [['usuario', { telefono: '+573001234567' }]]);
  assert.equal(updated.fullName, 'ana@mani.test', 'devuelve el nombre vigente, no el que no quedó guardado');
});

test('updateOwnProfile devuelve null si el perfil no es de ese tenant (C3: no toca perfiles ajenos)', async () => {
  const { client, calls } = recordingClient({ usuario: null });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  assert.equal(await repo.updateOwnProfile('u1', 'otro-tenant', { phone: '+573001234567' }), null);
  assert.deepEqual(calls.updates, []);
});
