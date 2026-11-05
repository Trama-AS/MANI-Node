// Numeración de db/migrations (ADR-0030 §1, TEC-08): incremental, sin repetidos y con los huecos documentados en db/README.md §2.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../../../db/migrations');
// Consumidos por ramas cerradas sin fusionar (SCRUM-865 y SCRUM-869). No se reutilizan.
const RETIRED = new Set([11, 12]);
// Desde la 0005 la versión registrada en schema_migrations es el número de cuatro dígitos.
const FIRST_PLAIN_VERSION = 5;

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const numbered = files.map((file) => {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
  return { file, number: match ? Number(match[1]) : null };
});

test('cada migración se llama NNNN_descripcion.sql', () => {
  const invalid = numbered.filter((m) => m.number === null).map((m) => m.file);
  assert.deepEqual(invalid, []);
});

test('ningún número de migración se repite', () => {
  const seen = new Map();
  for (const { file, number } of numbered) {
    assert.ok(!seen.has(number), `${file} repite el número de ${seen.get(number)}`);
    seen.set(number, file);
  }
});

test('los números retirados 0011 y 0012 no se reutilizan', () => {
  const reused = numbered.filter((m) => RETIRED.has(m.number)).map((m) => m.file);
  assert.deepEqual(reused, []);
});

test('la serie solo salta los números retirados', () => {
  const numbers = numbered.map((m) => m.number);
  const max = Math.max(...numbers);
  const missing = [];
  for (let n = 1; n <= max; n += 1) {
    if (!numbers.includes(n) && !RETIRED.has(n)) missing.push(n);
  }
  assert.deepEqual(missing, [], 'hueco no documentado en db/README.md §2.1');
});

test('desde la 0005 cada migración registra en schema_migrations la versión de su nombre', () => {
  for (const { file } of numbered.filter((m) => m.number >= FIRST_PLAIN_VERSION)) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    const match = /INSERT INTO schema_migrations\s*\(version,\s*description\)\s*VALUES\s*\(\s*'([^']+)'/i.exec(sql);
    assert.ok(match, `${file} no se registra en schema_migrations`);
    assert.equal(match[1], file.slice(0, 4), `${file} registra la versión '${match[1]}'`);
  }
});
