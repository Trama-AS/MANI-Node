const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const MIGRACION = path.join(ROOT, 'db/migrations/0029_zona_jerarquia_barrio.sql');
const VERIFY = path.join(ROOT, 'db/verify/0029_verificar_jerarquia_zona.sql');

describe('SCRUM-1395: migración 0029, integridad de la jerarquía geográfica hasta BARRIO', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  const verify = fs.readFileSync(VERIFY, 'utf8');

  it('limita el nivel a los tres del catálogo y exige zona padre salvo en CIUDAD', () => {
    assert.match(sql, /ADD CONSTRAINT zona_nivel_valido\s*\n?\s*CHECK \(nivel IN \('CIUDAD', 'LOCALIDAD', 'BARRIO'\)\)/);
    assert.match(
      sql,
      /ADD CONSTRAINT zona_padre_obligatorio_salvo_ciudad\s*\n?\s*CHECK \(nivel = 'CIUDAD' OR zona_padre_id IS NOT NULL\)/
    );
  });

  it('agrega los dos CHECK NOT VALID para no caerse sobre filas ya sembradas', () => {
    const checks = sql.match(/ADD CONSTRAINT zona_\w+[\s\S]*?;/g) ?? [];
    assert.equal(checks.length, 2);
    for (const check of checks) {
      assert.match(check, /NOT VALID/, `el CHECK debería ser NOT VALID: ${check}`);
    }
    // Y deja escrito cómo validarlos después de limpiar, para que no quede a medias en silencio.
    assert.match(sql, /VALIDATE CONSTRAINT zona_nivel_valido/);
    assert.match(sql, /VALIDATE CONSTRAINT zona_padre_obligatorio_salvo_ciudad/);
  });

  it('valida con trigger que el padre sea el nivel inmediatamente superior, que un CHECK no puede mirar', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION app\.validar_jerarquia_zona\(\)/);
    assert.match(sql, /BEFORE INSERT OR UPDATE ON zona/);
    assert.match(sql, /WHEN 'BARRIO' THEN 'LOCALIDAD'/);
    assert.match(sql, /WHEN 'LOCALIDAD' THEN 'CIUDAD'/);
    assert.match(sql, /una zona no puede ser su propia zona padre/);
    assert.match(sql, /una CIUDAD es raíz de la jerarquía y no puede tener zona padre/);
  });

  it('el trigger valida el nivel por su cuenta, porque corre antes que los CHECK', () => {
    assert.match(sql, /MANI-ZON-422N: nivel % no pertenece al catálogo/);
  });

  it('usa códigos del contrato en los mensajes y no filtra el motor', () => {
    const mensajes = sql.match(/RAISE EXCEPTION '([^']+)'/g) ?? [];
    assert.ok(mensajes.length >= 5, `esperaba al menos 5 mensajes, hay ${mensajes.length}`);
    for (const mensaje of mensajes) {
      assert.match(mensaje, /MANI-ZON-422[JN]:/, `mensaje sin código del contrato: ${mensaje}`);
    }
  });

  it('es idempotente y se registra en schema_migrations', () => {
    assert.match(sql, /DROP CONSTRAINT IF EXISTS zona_nivel_valido/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS zona_padre_obligatorio_salvo_ciudad/);
    assert.match(sql, /DROP TRIGGER IF EXISTS trg_zona_jerarquia ON zona/);
    assert.match(sql, /INSERT INTO schema_migrations \(version, description\)\s*\nVALUES \('0029'/);
    assert.match(sql, /ON CONFLICT \(version\) DO NOTHING/);
  });

  it('deja escrito que zona es catálogo global, sin tenant_id ni RLS que ajustar', () => {
    assert.match(sql, /NO tiene tenant_id/);
  });

  it('la verificación comprueba los CHECK, el trigger y lista las filas a limpiar', () => {
    assert.match(verify, /FROM pg_constraint/);
    assert.match(verify, /FROM pg_trigger/);
    assert.match(verify, /validar_jerarquia_zona/);
    assert.match(verify, /NIVEL_FUERA_DEL_CATALOGO/);
    assert.match(verify, /ZONA_SIN_PADRE/);
  });

  it('el número de migración no se repite en la serie', () => {
    const archivos = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter((f) => f.endsWith('.sql'));
    const con0029 = archivos.filter((f) => f.startsWith('0029'));
    assert.deepEqual(con0029, ['0029_zona_jerarquia_barrio.sql']);
  });
});
