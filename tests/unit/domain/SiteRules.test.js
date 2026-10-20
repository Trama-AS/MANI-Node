const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const SiteRules = require('../../../src/domain/entities/SiteRules');

describe('SiteRules Value Object (RF-09 / QS-06)', () => {
  it('debe validar un horario correcto (inicio menor que fin y días válidos)', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
    });

    assert.doesNotThrow(() => rules.validate());
    assert.strictEqual(rules.horario.inicio, '08:00');
    assert.strictEqual(rules.horario.fin, '17:00');
  });

  it('debe fallar si horario.inicio no es menor que horario.fin', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '18:00',
        fin: '08:00',
        diasPermitidos: ['LUN'],
      },
    });

    assert.throws(() => rules.validate(), /horario.inicio debe ser estrictamente menor/);
  });

  it('debe fallar si los días contienen valores inválidos', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'INVALIDO'],
      },
    });

    assert.throws(() => rules.validate(), /Día no permitido/);
  });

  it('debe evaluar fecha dentro del horario permitido retornando cumpleHorario: true', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
    });

    // Miércoles a las 10:30 am
    const res = rules.evaluateSchedule('2026-10-14T10:30:00');
    assert.strictEqual(res.cumpleHorario, true);
    assert.strictEqual(res.fueraDeHorario, false);
    assert.strictEqual(res.requiereJustificacion, false);
  });

  it('debe evaluar fecha fuera del horario permitido retornando requiereJustificacion: true', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
    });

    // Miércoles a las 19:00 (fuera de horario)
    const res = rules.evaluateSchedule('2026-10-14T19:00:00');
    assert.strictEqual(res.cumpleHorario, false);
    assert.strictEqual(res.fueraDeHorario, true);
    assert.strictEqual(res.requiereJustificacion, true);
    assert.ok(res.advertencia.includes('19:00'));
  });

  it('toAllyHighlightedView formatea alertas de alta y crítica severidad para el aliado', () => {
    const rules = new SiteRules({
      horario: { inicio: '07:00', fin: '16:00', diasPermitidos: ['LUN'] },
      permisosRequeridos: ['TRABAJO_ALTURAS', 'ARL_VIGENTE'],
      elementosProteccion: ['CASCO', 'GAFAS', 'BOTAS'],
      requiereAprobacionPrevia: true,
      instruccionesIngreso: 'Registrarse en recepción con documento original.',
    });

    const view = rules.toAllyHighlightedView();
    assert.strictEqual(view.totalRequisitos, 5);
    assert.ok(view.alertas.some((a) => a.tipo === 'PERMISOS' && a.severidad === 'CRITICA'));
    assert.ok(view.alertas.some((a) => a.tipo === 'EPP' && a.severidad === 'ALTA'));
    assert.ok(view.alertas.some((a) => a.tipo === 'HORARIO'));
  });

  it('debe evaluar correctamente la zona horaria America/Bogota (evita desfases en servidores UTC)', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
    });

    // 8 de octubre de 2026 es jueves (JUE)
    // Caso 1: 16:20 en Bogotá (dentro de horario)
    const resDentro = rules.evaluateSchedule('2026-10-08T16:20:00-05:00');
    assert.strictEqual(resDentro.cumpleHorario, true);
    assert.strictEqual(resDentro.fueraDeHorario, false);

    // Caso 2: 06:00 en Bogotá (fuera de horario)
    const resFuera = rules.evaluateSchedule('2026-10-08T06:00:00-05:00');
    assert.strictEqual(resFuera.cumpleHorario, false);
    assert.strictEqual(resFuera.fueraDeHorario, true);
    assert.strictEqual(resFuera.requiereJustificacion, true);
  });

  it('debe rechazar con ValidationError si permisosRequeridos o elementosProteccion no son arreglos de strings', () => {
    const rulesPermisosInvalidos = new SiteRules({
      permisosRequeridos: [123, null],
    });
    assert.throws(
      () => rulesPermisosInvalidos.validate(),
      (err) => err.code === 'VALIDATION_ERROR' && err.statusCode === 400
    );

    const rulesEppInvalidos = new SiteRules({
      elementosProteccion: 'no-es-arreglo',
    });
    assert.throws(
      () => rulesEppInvalidos.validate(),
      (err) => err.code === 'VALIDATION_ERROR' && err.statusCode === 400
    );
  });
});
