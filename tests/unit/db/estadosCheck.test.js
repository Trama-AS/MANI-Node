// SCRUM-1713 (QAS-10): el catálogo de estados del código y el CHECK de la migración 0043 dicen lo mismo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ESTADOS_SOLICITUD, ESTADOS_COTIZACION } = require('../../../src/domain/estados');

const RAIZ = path.join(__dirname, '../../..');
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
const literales = (texto) => [...texto.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

const MIGRACION = leer('db/migrations/0043_estado_solicitud_cotizacion_check.sql');
// Cada lista `estado IN ('A', 'B', ...)` o `estado NOT IN (...)` de la migración (el CHECK y la validación condicional).
const LISTAS_SQL = [...MIGRACION.matchAll(/estado\s+(?:NOT\s+)?IN\s*\(([^)]*)\)/g)].map((m) => literales(m[1]));

const igual = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

test('el catálogo no repite estados', () => {
  assert.equal(new Set(ESTADOS_SOLICITUD).size, ESTADOS_SOLICITUD.length);
  assert.equal(new Set(ESTADOS_COTIZACION).size, ESTADOS_COTIZACION.length);
});

test('la migración 0043 usa solo las listas del catálogo, dos veces cada una (CHECK y validación)', () => {
  assert.equal(LISTAS_SQL.length, 4, 'se esperaban 4 listas: 2 CHECK y 2 validaciones condicionales');
  const deSolicitud = LISTAS_SQL.filter((l) => igual(l, ESTADOS_SOLICITUD));
  const deCotizacion = LISTAS_SQL.filter((l) => igual(l, ESTADOS_COTIZACION));
  assert.equal(deSolicitud.length, 2, 'la lista de solicitud de la migración no coincide con ESTADOS_SOLICITUD');
  assert.equal(deCotizacion.length, 2, 'la lista de cotizacion de la migración no coincide con ESTADOS_COTIZACION');
});

test('la migración agrega los CHECK NOT VALID y los registra en schema_migrations', () => {
  assert.match(MIGRACION, /ck_solicitud_estado[\s\S]*?NOT VALID/);
  assert.match(MIGRACION, /ck_cotizacion_estado[\s\S]*?NOT VALID/);
  assert.match(MIGRACION, /INSERT INTO schema_migrations[\s\S]*?VALUES \('0043'/);
});

test('los estados de solicitud que escribe o consulta el código están en el catálogo', () => {
  const fuentes = [
    'src/infrastructure/repositories/PgQuoteRepository.js',
    'src/infrastructure/repositories/PgServiceRequestRepository.js',
    'src/infrastructure/repositories/PgMessageRepository.js',
    'src/infrastructure/repositories/PgAdditionRepository.js',
    'src/application/useCases/ratings/RatingsAndClosureUseCase.js',
  ];
  const usados = [];
  for (const fuente of fuentes) {
    for (const m of leer(fuente).matchAll(/ESTADOS_[A-Z_]+\s*=\s*(?:new Set\()?\[([^\]]*)\]/g)) usados.push(...literales(m[1]));
  }
  assert.ok(usados.length > 0, 'no se encontró ninguna lista ESTADOS_* en el código');
  const fuera = [...new Set(usados)].filter((e) => !ESTADOS_SOLICITUD.includes(e));
  assert.deepEqual(fuera, [], `estados del código fuera del CHECK de solicitud: ${fuera.join(', ')}`);
});

test('las decisiones sobre una cotización producen estados del catálogo', () => {
  const caso = leer('src/application/useCases/quotes/RespondQuoteUseCase.js');
  const deCotizacion = [...caso.matchAll(/cotizacion:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  const deSolicitud = [...caso.matchAll(/solicitud:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(deCotizacion.length > 0 && deSolicitud.length > 0);
  assert.deepEqual(deCotizacion.filter((e) => !ESTADOS_COTIZACION.includes(e)), []);
  assert.deepEqual(deSolicitud.filter((e) => !ESTADOS_SOLICITUD.includes(e)), []);
});
