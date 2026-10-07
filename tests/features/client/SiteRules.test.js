const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SiteRules } = require('../../../src/features/client/domain/SiteRules');

describe('SiteRules Domain Value Object (US-02.2.3 / RF-09)', () => {
  it('debe crear y validar reglas contextuales completas', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
      permisosRequeridos: ['ARL_VIGENTE', 'CERTIFICADO_ALTURAS'],
      elementosProteccion: ['BOTAS_SEGURIDAD', 'CASCO', 'CHALECO'],
      instruccionesIngreso: 'Ingreso por portería norte con documento de identidad.',
      requiereAprobacionPrevia: true,
      contactoAcceso: { nombre: 'Seguridad Planta', telefono: '3001234567' },
    });

    assert.doesNotThrow(() => rules.validate());
    assert.strictEqual(rules.horario.inicio, '08:00');
    assert.strictEqual(rules.horario.fin, '17:00');
    assert.strictEqual(rules.permisosRequeridos.length, 2);
    assert.strictEqual(rules.elementosProteccion.length, 3);
  });

  it('debe fallar si horario.inicio no es menor que horario.fin', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '18:00',
        fin: '08:00',
      },
    });

    assert.throws(() => rules.validate(), /horario.inicio debe ser menor que horario.fin/);
  });

  it('debe fallar si los días permitidos contienen un día inválido', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'FIESTA'],
      },
    });

    assert.throws(() => rules.validate(), /Día "FIESTA" inválido/);
  });

  it('Scenario 2: evaluateSchedule debe aprobar horarios dentro de rango y advertir fuera de rango', () => {
    const rules = new SiteRules({
      horario: {
        inicio: '08:00',
        fin: '17:00',
        diasPermitidos: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
      },
    });

    // 2026-10-14 es Miércoles (MIE) a las 10:00 -> Válido
    const horarioValido = new Date('2026-10-14T10:00:00');
    const evalValida = rules.evaluateSchedule(horarioValido);
    assert.strictEqual(evalValida.cumpleHorario, true);
    assert.strictEqual(evalValida.fueraDeHorario, false);
    assert.strictEqual(evalValida.requiereJustificacion, false);
    assert.strictEqual(evalValida.advertencia, null);

    // 2026-10-14 es Miércoles (MIE) a las 19:00 -> Fuera de horario (Scenario 2 BDD)
    const horarioFueraRango = new Date('2026-10-14T19:00:00');
    const evalFuera = rules.evaluateSchedule(horarioFueraRango);
    assert.strictEqual(evalFuera.cumpleHorario, false);
    assert.strictEqual(evalFuera.fueraDeHorario, true);
    assert.strictEqual(evalFuera.requiereJustificacion, true);
    assert.match(evalFuera.advertencia, /ADVERTENCIA: Agendamiento fuera de horario permitido/);
  });

  it('Scenario 1 / QS-06: toAllyHighlightedView debe retornar la ficha de reglas destacadas para el aliado', () => {
    const rules = new SiteRules({
      horario: { inicio: '08:00', fin: '17:00' },
      permisosRequeridos: ['ARL_VIGENTE'],
      elementosProteccion: ['BOTAS_SEGURIDAD'],
    });

    const vistaAliado = rules.toAllyHighlightedView();
    assert.strictEqual(vistaAliado.horarioAcceso.rango, '08:00 - 17:00');
    assert.deepStrictEqual(vistaAliado.permisosObligatorios, ['ARL_VIGENTE']);
    assert.deepStrictEqual(vistaAliado.elementosProteccionObligatorios, ['BOTAS_SEGURIDAD']);
    assert.strictEqual(vistaAliado.totalRequisitos, 2);
  });
});
