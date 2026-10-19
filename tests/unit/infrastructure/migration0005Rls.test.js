const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'migrations',
  '0005_cerrar_exposiciones_rls.sql'
);

const VERIFY_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'verify',
  '0005_verificar_exposiciones.sql'
);

describe('SCRUM-1334 (BUG-SEC-02): Migración 0005 cierra exposiciones inmediatas a anon en RLS', () => {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const verifySql = fs.readFileSync(VERIFY_PATH, 'utf8');

  test('revoca EXECUTE de PUBLIC, anon y authenticated sobre funciones SECURITY DEFINER de registro de aliado', () => {
    assert.match(migrationSql, /registrar_aliado_persona_natural/);
    assert.match(migrationSql, /registrar_aliado_empresa/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION %s FROM %I/);
    assert.match(migrationSql, /ARRAY\['anon',\s*'authenticated'\]/);
  });

  test('habilita RLS y elimina las políticas abiertas USING (true) / WITH CHECK (true) en documento_kyc', () => {
    assert.match(migrationSql, /ALTER TABLE IF EXISTS documento_kyc ENABLE ROW LEVEL SECURITY/);
    assert.match(
      migrationSql,
      /DROP POLICY IF EXISTS "Aliados pueden subir sus documentos KYC" ON documento_kyc/
    );
    assert.match(
      migrationSql,
      /DROP POLICY IF EXISTS "Aliados pueden consultar sus documentos KYC" ON documento_kyc/
    );
  });

  test('habilita RLS en las 11 tablas de negocio que carecían de ella y preserva lectura pública de zona', () => {
    const expectedTables = [
      'cliente',
      'sitio',
      'tarifa_referencia',
      'cobertura_aliado',
      'solicitud',
      'cotizacion',
      'mensaje',
      'evento_servicio',
      'calificacion',
      'notificacion',
      'zona',
    ];

    for (const table of expectedTables) {
      assert.match(migrationSql, new RegExp(`'${table}'`), `Falta tabla ${table} en migración 0005`);
      assert.match(verifySql, new RegExp(`'${table}'`), `Falta tabla ${table} en verificación 0005`);
    }

    assert.match(migrationSql, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
    assert.match(migrationSql, /CREATE POLICY zona_lectura_publica ON zona FOR SELECT USING \(true\)/);
  });

  test('registra la versión 0005 en schema_migrations de forma idempotente', () => {
    assert.match(migrationSql, /INSERT INTO schema_migrations \(version, description\)/);
    assert.match(migrationSql, /VALUES \('0005'/);
    assert.match(migrationSql, /ON CONFLICT \(version\) DO NOTHING/);
  });

  test('el script de verificación es transaccional (BEGIN/ROLLBACK) y comprueba anon y service_role', () => {
    assert.match(verifySql, /BEGIN;/);
    assert.match(verifySql, /SET LOCAL ROLE anon;/);
    assert.match(verifySql, /SET LOCAL ROLE service_role;/);
    assert.match(verifySql, /ROLLBACK;/);
  });
});
