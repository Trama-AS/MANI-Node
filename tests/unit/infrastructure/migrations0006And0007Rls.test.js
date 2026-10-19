const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATION_0006_PATH = path.join(ROOT, 'db/migrations/0006_contexto_identidad.sql');
const MIGRATION_0007_PATH = path.join(ROOT, 'db/migrations/0007_politicas_por_tenant.sql');
const VERIFY_0007_PATH = path.join(ROOT, 'db/verify/0007_verificar_modelo_identidad_rls.sql');
const DB_README_PATH = path.join(ROOT, 'db/README.md');

function listJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

describe('SCRUM-1104 (CFG-23b) & SCRUM-1159: Migraciones 0006 y 0007 de identidad y políticas RLS', () => {
  const sql0006 = fs.readFileSync(MIGRATION_0006_PATH, 'utf8');
  const sql0007 = fs.readFileSync(MIGRATION_0007_PATH, 'utf8');
  const verify0007 = fs.readFileSync(VERIFY_0007_PATH, 'utf8');
  const dbReadme = fs.readFileSync(DB_README_PATH, 'utf8');

  it('0006 crea los roles mani_core_svc y mani_dispatch_svc con NOLOGIN NOBYPASSRLS y les concede USAGE sobre auth', () => {
    assert.match(sql0006, /CREATE ROLE mani_core_svc NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    assert.match(sql0006, /CREATE ROLE mani_dispatch_svc NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    assert.match(
      sql0006,
      /GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc/
    );
    assert.match(
      sql0006,
      /GRANT EXECUTE ON FUNCTION auth\.jwt\(\), auth\.uid\(\) TO anon, authenticated, service_role, mani_core_svc, mani_dispatch_svc/
    );
  });

  it('0006 define el esquema app, las lectoras fail-closed y app.set_context con is_local = true y MANI-RLS-400', () => {
    assert.match(sql0006, /CREATE SCHEMA IF NOT EXISTS app;/);
    assert.match(sql0006, /REVOKE ALL ON SCHEMA app FROM PUBLIC;/);
    assert.match(sql0006, /CREATE OR REPLACE FUNCTION app\.tenant_id\(\)/);
    assert.match(sql0006, /CREATE OR REPLACE FUNCTION app\.user_id\(\)/);
    assert.match(sql0006, /CREATE OR REPLACE FUNCTION app\.user_role\(\)/);
    assert.match(sql0006, /CREATE OR REPLACE FUNCTION app\.set_context\(/);
    assert.match(sql0006, /MANI-RLS-400: el contexto exige tenant_id/);
    assert.match(sql0006, /pg_catalog\.set_config\(\s*'request\.jwt\.claims'[\s\S]*?true\s*\)/);
    assert.match(sql0006, /REVOKE ALL ON FUNCTION app\.set_context\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated;/);
    assert.match(sql0006, /GRANT EXECUTE ON FUNCTION app\.set_context\(uuid, uuid, text\) TO mani_core_svc, mani_dispatch_svc;/);
    assert.match(sql0006, /VALUES\s*\(\s*'0006'/);
  });

  it('0007 impone la frontera de datos de ADR-0030 por GRANT y habilita ENABLE + FORCE RLS en todas las tablas con tenant_id', () => {
    assert.match(sql0007, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mani_core_svc, mani_dispatch_svc;/);
    assert.match(sql0007, /GRANT SELECT ON tenant, zona TO anon, authenticated, mani_core_svc, mani_dispatch_svc;/);
    assert.match(sql0007, /GRANT SELECT, INSERT, UPDATE ON solicitud TO mani_core_svc;/);
    assert.match(sql0007, /GRANT SELECT, UPDATE ON solicitud TO mani_dispatch_svc;/);
    assert.match(sql0007, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
    assert.match(sql0007, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);

    const tenantTables = [
      'usuario',
      'categoria_servicio',
      'aliado',
      'cliente',
      'sitio',
      'aliado_categoria',
      'cobertura_aliado',
      'documento_kyc',
      'tarifa_referencia',
      'solicitud',
      'cotizacion',
      'mensaje',
      'evento_servicio',
      'calificacion',
      'notificacion',
      'aliado_ausencia',
      'solicitud_rechazo',
      'solicitud_foto',
      'documento_legal',
      'consentimiento_usuario',
    ];
    for (const table of tenantTables) {
      assert.ok(sql0007.includes(`'${table}'`), `Falta la tabla ${table} en el bloque de FORCE RLS de 0007`);
    }
  });

  it('0007 crea las políticas canónicas con app.tenant_id(), app.user_id() y app.user_role() y registra la versión 0007', () => {
    assert.match(sql0007, /CREATE POLICY tenant_lectura ON tenant/);
    assert.match(sql0007, /CREATE POLICY zona_lectura ON zona/);
    assert.match(sql0007, /CREATE POLICY %1\$s_tenant ON %1\$I/);
    assert.match(sql0007, /CREATE POLICY documento_kyc_lectura ON documento_kyc/);
    assert.match(sql0007, /CREATE POLICY documento_kyc_alta ON documento_kyc/);
    assert.match(sql0007, /CREATE POLICY solicitud_lectura ON solicitud/);
    assert.match(sql0007, /CREATE POLICY solicitud_alta_cliente ON solicitud/);
    assert.match(sql0007, /CREATE POLICY solicitud_aceptar_aliado ON solicitud/);
    assert.match(sql0007, /CREATE POLICY solicitud_rechazo_aliado ON solicitud_rechazo/);
    assert.match(sql0007, /CREATE POLICY kyc_isolation ON storage\.objects/);
    assert.match(sql0007, /CREATE POLICY solicitudes_isolation ON storage\.objects/);
    assert.match(sql0007, /VALUES\s*\(\s*'0007'/);
  });

  it('incluye el script de verificación 0007 con los 6 casos cross-tenant (C1–C6), propiedades (P1–P6) y documentación en db/README.md', () => {
    assert.match(verify0007, /FALLO 0007: tablas con tenant_id sin FORCE RLS/);
    assert.match(verify0007, /FALLO 0007: políticas con TO public implícito/);
    assert.match(verify0007, /OK 0007: modelo de identidad, politicas RLS y 6 casos cross-tenant verificados/);
    assert.match(verify0007, /ROLLBACK;/);

    assert.match(dbReadme, /ADR-0032/);
    assert.match(dbReadme, /0006_contexto_identidad\.sql/);
    assert.match(dbReadme, /0007_politicas_por_tenant\.sql/);
    assert.match(dbReadme, /mani_core_svc/);
    assert.match(dbReadme, /mani_dispatch_svc/);
  });

  it('regla de CI (02-diseno-modelo-identidad.md §6): ningún archivo en src/ usa set_config(..., false) de sesión', () => {
    const srcFiles = listJsFiles(path.join(ROOT, 'src'));
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        content,
        /set_config\s*\([^)]*,\s*false\s*\)/i,
        `Uso prohibido de set_config(..., false) en ${path.relative(ROOT, file)}`
      );
    }
  });
});
