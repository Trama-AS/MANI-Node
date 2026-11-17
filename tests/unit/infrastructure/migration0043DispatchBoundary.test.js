const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('SCRUM-1660 (T-23 / QAS-20): la migración 0043 revoca permisos de lectura de mani_dispatch_svc sobre tablas de Core', () => {
  const sql0043 = fs.readFileSync(
    path.resolve(__dirname, '../../../db/migrations/0043_retirar_lecturas_core_en_dispatch.sql'),
    'utf8'
  );

  assert.match(sql0043, /REVOKE ALL ON TABLE tenant, zona, solicitud FROM mani_dispatch_svc;/);
  assert.match(sql0043, /CREATE POLICY tenant_lectura ON tenant\s+FOR SELECT TO anon, authenticated, mani_core_svc/);
  assert.match(sql0043, /CREATE POLICY zona_lectura ON zona\s+FOR SELECT TO anon, authenticated, mani_core_svc/);
  assert.match(sql0043, /CREATE POLICY solicitud_lectura ON solicitud\s+FOR SELECT TO authenticated, mani_core_svc/);
  assert.match(sql0043, /VALUES \('0043'/);
});
