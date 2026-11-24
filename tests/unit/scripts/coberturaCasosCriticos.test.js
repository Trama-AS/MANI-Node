const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { leerLcov, medir, tablaMarkdown, main, CASOS_CRITICOS } = require('../../../scripts/cobertura-casos-criticos');

// SCRUM-1727 (QAS-23): el reporte del CI muestra el porcentaje de cada caso de uso crítico.

const [APROBAR, REGLAS] = CASOS_CRITICOS.map((c) => c.archivo);
const registro = (sf, lf, lh) => `TN:\nSF:${sf}\nDA:1,1\nLF:${lf}\nLH:${lh}\nend_of_record`;
const lcov = (...registros) => registros.join('\n') + '\n';

test('lee líneas encontradas y cubiertas de cada archivo del lcov', () => {
  const mapa = leerLcov(lcov(registro(APROBAR, 64, 58), registro('src/otro.js', 10, 10)));
  assert.equal(mapa.size, 2);
  assert.deepEqual(mapa.get(APROBAR), { archivo: APROBAR, encontradas: 64, cubiertas: 58 });
});

test('mide el porcentaje de cada caso de uso crítico', () => {
  const filas = medir(leerLcov(lcov(registro(APROBAR, 64, 64), registro(REGLAS, 27, 24))));
  assert.equal(filas[0].porcentaje, 100);
  assert.equal(Math.round(filas[1].porcentaje * 100) / 100, 88.89);
});

test('un caso de uso que no aparece en el lcov queda "sin datos", nunca 0 ni 100', () => {
  const filas = medir(leerLcov(lcov(registro(APROBAR, 64, 64))));
  assert.equal(filas[1].porcentaje, null);
  assert.match(tablaMarkdown(filas), /Reglas del tenant \| 0 de 0 \| sin datos \| ⚠️ sin datos/);
});

test('acepta rutas con prefijo y con separadores de Windows', () => {
  const filas = medir(leerLcov(lcov(registro(`C:\\repo\\${APROBAR.replace(/\//g, '\\')}`, 10, 9))));
  assert.equal(filas[0].porcentaje, 90);
});

test('la tabla marca ✅ desde el mínimo y ❌ por debajo', () => {
  const tabla = tablaMarkdown(medir(leerLcov(lcov(registro(APROBAR, 100, 90), registro(REGLAS, 100, 89)))));
  assert.match(tabla, /Aprobar aliado \| 90 de 100 \| 90,00 % \| ✅/);
  assert.match(tabla, /Reglas del tenant \| 89 de 100 \| 89,00 % \| ❌ < 90 %/);
});

test('main escribe la tabla en el resumen del job y es informativo (código 0) sin --min', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cob-'));
  const archivo = path.join(dir, 'lcov.info');
  const resumen = path.join(dir, 'resumen.md');
  fs.writeFileSync(archivo, lcov(registro(APROBAR, 100, 50), registro(REGLAS, 100, 50)));
  const original = console.log;
  console.log = () => {};
  try {
    assert.equal(main([archivo], { GITHUB_STEP_SUMMARY: resumen }), 0);
    assert.equal(main([archivo, '--min=90'], {}), 1);
  } finally {
    console.log = original;
  }
  assert.match(fs.readFileSync(resumen, 'utf8'), /Cobertura de líneas de los casos de uso críticos/);
});

test('main con --min=90 sale 0 cuando todos cumplen y 2 si no existe el lcov', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cob-'));
  const archivo = path.join(dir, 'lcov.info');
  fs.writeFileSync(archivo, lcov(registro(APROBAR, 100, 95), registro(REGLAS, 100, 100)));
  const original = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(main([archivo, '--min=90'], {}), 0);
    assert.equal(main([path.join(dir, 'no-existe.info')], {}), 2);
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
});
