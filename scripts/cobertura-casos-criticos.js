#!/usr/bin/env node
// SCRUM-1727 (QAS-23): muestra el porcentaje de cobertura de líneas de cada caso de uso crítico de Core, leído del lcov
// que genera `npm run test:coverage`. En CI se escribe en el resumen del job (GITHUB_STEP_SUMMARY); en local, en consola.
// Informativo: no falla el CI. Con `--min=90` sale con código 1 si algún caso de uso queda por debajo.
const fs = require('node:fs');

const MINIMO_QAS_23 = 90;

const CASOS_CRITICOS = [
  { nombre: 'Aprobar aliado', archivo: 'src/application/useCases/verification/ResolveAllyVerificationUseCase.js' },
  { nombre: 'Reglas del tenant', archivo: 'src/application/useCases/tenantRules/TenantRulesUseCase.js' },
];

/** Líneas encontradas (LF) y cubiertas (LH) de cada archivo de un lcov, por su ruta (SF). */
function leerLcov(texto) {
  const porArchivo = new Map();
  let actual = null;
  for (const linea of String(texto).split(/\r?\n/)) {
    if (linea.startsWith('SF:')) actual = { archivo: linea.slice(3).trim().replace(/\\/g, '/'), encontradas: 0, cubiertas: 0 };
    else if (actual && linea.startsWith('LF:')) actual.encontradas = Number(linea.slice(3));
    else if (actual && linea.startsWith('LH:')) actual.cubiertas = Number(linea.slice(3));
    else if (actual && linea === 'end_of_record') {
      porArchivo.set(actual.archivo, actual);
      actual = null;
    }
  }
  return porArchivo;
}

/** Una fila por caso de uso crítico; `porcentaje` es null si el archivo no aparece en el lcov. */
function medir(porArchivo, casos = CASOS_CRITICOS) {
  return casos.map(({ nombre, archivo }) => {
    const dato = [...porArchivo.values()].find((d) => d.archivo === archivo || d.archivo.endsWith(`/${archivo}`));
    const porcentaje = dato && dato.encontradas > 0 ? (100 * dato.cubiertas) / dato.encontradas : null;
    return { nombre, archivo, encontradas: dato?.encontradas ?? 0, cubiertas: dato?.cubiertas ?? 0, porcentaje };
  });
}

const formato = (p) => (p === null ? 'sin datos' : `${p.toFixed(2).replace('.', ',')} %`);

function tablaMarkdown(filas, minimo = MINIMO_QAS_23) {
  const estado = (p) => (p === null ? '⚠️ sin datos' : p >= minimo ? '✅' : `❌ < ${minimo} %`);
  return [
    `### Cobertura de líneas de los casos de uso críticos (QAS-23, mínimo ${minimo} %)`,
    '',
    '| Caso de uso | Líneas cubiertas | Cobertura | Estado |',
    '|---|---|---|---|',
    ...filas.map((f) => `| ${f.nombre} | ${f.cubiertas} de ${f.encontradas} | ${formato(f.porcentaje)} | ${estado(f.porcentaje)} |`),
    '',
  ].join('\n');
}

function main(argv = process.argv.slice(2), env = process.env) {
  const ruta = argv.find((a) => !a.startsWith('--')) || 'coverage/lcov.info';
  const minArg = argv.find((a) => a.startsWith('--min='));
  const minimo = minArg ? Number(minArg.slice(6)) : MINIMO_QAS_23;
  if (!fs.existsSync(ruta)) {
    console.error(`No existe ${ruta}: corre antes "npm run test:coverage".`);
    return 2;
  }
  const filas = medir(leerLcov(fs.readFileSync(ruta, 'utf8')));
  const tabla = tablaMarkdown(filas, minimo);
  console.log(tabla);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${tabla}\n`);
  return minArg && filas.some((f) => f.porcentaje === null || f.porcentaje < minimo) ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { leerLcov, medir, tablaMarkdown, main, CASOS_CRITICOS, MINIMO_QAS_23 };
