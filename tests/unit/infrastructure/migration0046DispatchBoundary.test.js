const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('SCRUM-1660 (T-23 / QAS-20): la migración 0046 revoca permisos de lectura de mani_dispatch_svc sobre tablas de Core', () => {
  const sql0046 = fs.readFileSync(
    path.resolve(__dirname, '../../../db/migrations/0046_retirar_lecturas_core_en_dispatch.sql'),
    'utf8'
  );

  assert.match(sql0046, /REVOKE ALL ON TABLE tenant, zona, solicitud FROM mani_dispatch_svc;/);
  // tenant y zona solo para authenticated y Core: ni anon (SCRUM-1720) ni Dispatch (SCRUM-1660).
  assert.match(sql0046, /WHERE rolname IN \('authenticated', 'mani_core_svc'\)/);
  assert.match(sql0046, /CREATE POLICY tenant_lectura ON tenant FOR SELECT TO %s USING \(true\)/);
  assert.match(sql0046, /CREATE POLICY zona_lectura ON zona FOR SELECT TO %s USING \(true\)/);
  assert.doesNotMatch(sql0046, /TO\s+anon|'anon'/);
  assert.match(sql0046, /CREATE POLICY solicitud_lectura ON solicitud\s+FOR SELECT TO authenticated, mani_core_svc/);
  assert.match(sql0046, /VALUES \('0046'/);
});
