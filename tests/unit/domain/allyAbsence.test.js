const test = require('node:test');
const assert = require('node:assert/strict');
const AllyAbsence = require('../../../src/domain/entities/AllyAbsence');

const base = {
  tenantId: 't1',
  aliadoId: 'a1',
  startsAt: '2026-10-20T08:00:00-05:00',
  endsAt: '2026-10-25T18:00:00-05:00',
  reason: 'VACACIONES',
};

function assertCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    assert.equal(err.statusCode, 422);
    return true;
  });
}

test('AllyAbsence acepta un intervalo válido y normaliza fechas a UTC', () => {
  const absence = new AllyAbsence({ ...base, note: '  Viaje  ' });

  assert.equal(absence.startsAt.toISOString(), '2026-10-20T13:00:00.000Z');
  assert.equal(absence.note, 'Viaje');
  assert.equal(absence.toJSON().reason, 'VACACIONES');
});

test('AllyAbsence rechaza fin igual o anterior al inicio (MANI-AUS-422H)', () => {
  assertCode(() => new AllyAbsence({ ...base, endsAt: base.startsAt }), 'MANI-AUS-422H');
  assertCode(() => new AllyAbsence({ ...base, endsAt: '2026-10-19T08:00:00-05:00' }), 'MANI-AUS-422H');
});

test('AllyAbsence rechaza ausencias de más de 365 días (MANI-AUS-422H)', () => {
  assertCode(() => new AllyAbsence({ ...base, endsAt: '2027-10-21T08:00:00-05:00' }), 'MANI-AUS-422H');
});

test('AllyAbsence exige fechas ISO-8601 con zona horaria (MANI-AUS-422V)', () => {
  assertCode(() => new AllyAbsence({ ...base, startsAt: '2026-10-20T08:00:00' }), 'MANI-AUS-422V');
  assertCode(() => new AllyAbsence({ ...base, startsAt: '20/10/2026' }), 'MANI-AUS-422V');
  assertCode(() => new AllyAbsence({ ...base, endsAt: undefined }), 'MANI-AUS-422V');
  assertCode(() => new AllyAbsence({ ...base, startsAt: '2026-13-40T08:00:00Z' }), 'MANI-AUS-422V');
});

test('AllyAbsence valida el motivo y el largo de la nota (MANI-AUS-422V)', () => {
  assertCode(() => new AllyAbsence({ ...base, reason: 'PASEO' }), 'MANI-AUS-422V');
  assertCode(() => new AllyAbsence({ ...base, note: 'x'.repeat(281) }), 'MANI-AUS-422V');
  assertCode(() => new AllyAbsence({ ...base, note: 42 }), 'MANI-AUS-422V');
});

test('assertNotFinished rechaza una ausencia que ya terminó', () => {
  const absence = new AllyAbsence(base);

  assert.doesNotThrow(() => absence.assertNotFinished(new Date('2026-10-22T00:00:00Z')));
  assertCode(() => absence.assertNotFinished(new Date('2026-10-26T00:00:00Z')), 'MANI-AUS-422H');
});

test('overlaps usa intervalo semiabierto: tocarse en el borde no es solapamiento', () => {
  const absence = new AllyAbsence(base);
  const contiguous = new AllyAbsence({ ...base, startsAt: base.endsAt, endsAt: '2026-10-26T18:00:00-05:00' });
  const crossing = new AllyAbsence({ ...base, startsAt: '2026-10-25T17:00:00-05:00', endsAt: '2026-10-26T18:00:00-05:00' });

  assert.equal(absence.overlaps(contiguous), false);
  assert.equal(absence.overlaps(crossing), true);
});

test('isActiveAt indica si el aliado está no disponible en ese instante', () => {
  const absence = new AllyAbsence(base);

  assert.equal(absence.isActiveAt(new Date('2026-10-21T00:00:00Z')), true);
  assert.equal(absence.isActiveAt(new Date('2026-10-25T23:00:00Z')), false);
});
