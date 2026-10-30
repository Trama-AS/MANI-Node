const { dominio } = require('../sesionDeDominio');
const { centavos } = require('../quotes/importe');

const { invalido, sesion, uuid, fecha, texto, periodo } = dominio('MANI-TAR');

const MONEDA_RE = /^[A-Z]{3}$/;
// El reporte se evalúa completo en Rules en cada consulta; un trimestre acota el lote.
const MAX_DIAS_REPORTE = 92;

/** Hoy en Colombia: la vigencia es una fecha de calendario del tenant, no del reloj UTC del contenedor. */
function hoyEnBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/**
 * Valores y vigencia de una tarifa (C2 de SCRUM-885): no negativos, mínimo <= típico <= máximo con mínimo < máximo,
 * vigencia con hasta >= desde y moneda ISO 4217. La base vuelve a exigirlo (migración 0029).
 */
function tarifaValida(body = {}) {
  const min = centavos(body.valorMin, 'valorMin', invalido);
  const tipico = centavos(body.valorTipico, 'valorTipico', invalido);
  const max = centavos(body.valorMax, 'valorMax', invalido);
  if (!(min <= tipico && tipico <= max)) throw invalido('los valores deben cumplir valorMin <= valorTipico <= valorMax');
  if (!(min < max)) throw invalido('valorMin debe ser menor que valorMax');

  const moneda = body.moneda === undefined || body.moneda === null ? 'COP' : String(body.moneda).trim().toUpperCase();
  if (!MONEDA_RE.test(moneda)) throw invalido('moneda debe ser un código ISO 4217 de tres letras');

  const vigenciaDesde = body.vigenciaDesde ? fecha(body.vigenciaDesde, 'vigenciaDesde') : hoyEnBogota();
  const vigenciaHasta = body.vigenciaHasta ? fecha(body.vigenciaHasta, 'vigenciaHasta') : null;
  if (vigenciaHasta && vigenciaHasta < vigenciaDesde) throw invalido('vigenciaHasta no puede ser anterior a vigenciaDesde');

  return {
    valorMin: min / 100,
    valorTipico: tipico / 100,
    valorMax: max / 100,
    moneda,
    vigenciaDesde,
    vigenciaHasta,
    condiciones: texto(body.condiciones, 'condiciones', { max: 500 }),
  };
}

/**
 * Tarifario de referencia (M-10). Core persiste las tarifas y Rules decide si una cotización está en rango
 * (Mesa CFG-23a punto M2): Core no compara importes contra la tarifa.
 *   * SCRUM-885: el administrador del tenant carga, edita (versión nueva), consulta y ve el historial.
 *   * SCRUM-886: el cliente dueño y el aliado asignado ven la tarifa vigente de la categoría al cotizar.
 *   * SCRUM-887: el administrador ve las cotizaciones del periodo que Rules evaluó fuera de rango.
 */
class TariffsUseCase {
  constructor({ tariffRepository, ruleEvaluationService }) {
    if (!tariffRepository) throw new Error('tariffRepository es requerido para TariffsUseCase');
    if (!ruleEvaluationService) throw new Error('ruleEvaluationService es requerido para TariffsUseCase');
    this.tariffRepository = tariffRepository;
    this.ruleEvaluationService = ruleEvaluationService;
  }

  async crear({ user, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant gestiona el tarifario');
    const categoriaId = uuid(body.categoriaId, 'categoriaId');
    return this.tariffRepository.crear(ctx, { categoriaId, ...tarifaValida(body), correlationId });
  }

  async editar({ user, tarifaId, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant gestiona el tarifario');
    const id = uuid(tarifaId, 'el id de la tarifa');
    return this.tariffRepository.reemplazar(ctx, { tarifaId: id, ...tarifaValida(body), correlationId });
  }

  async listar({ user, query = {} }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant consulta el tarifario');
    const categoriaId = query.categoriaId ? uuid(query.categoriaId, 'categoriaId') : null;
    return this.tariffRepository.listarActivas(ctx, { categoriaId });
  }

  async historial({ user, categoriaId }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant consulta el tarifario');
    return this.tariffRepository.historial(ctx, { categoriaId: uuid(categoriaId, 'categoriaId') });
  }

  async referenciaDeSolicitud({ user, solicitudId }) {
    const ctx = sesion(user, ['CLIENT', 'ALLY', 'ADMIN'], 'tu rol no consulta tarifas de referencia');
    return this.tariffRepository.vigenteParaSolicitud(ctx, {
      solicitudId: uuid(solicitudId, 'el id de la solicitud'),
      fecha: hoyEnBogota(),
    });
  }

  async reporteFueraDeRango({ user, query = {}, correlationId = null }) {
    const ctx = sesion(user, ['ADMIN'], 'solo el administrador del tenant consulta el reporte');
    const rango = periodo(query, MAX_DIAS_REPORTE);
    const cotizaciones = await this.tariffRepository.cotizacionesConTarifa(ctx, rango);

    const conTarifa = cotizaciones.filter((c) => c.tarifa);
    // Sin cotizaciones con tarifa no hay nada que evaluar: el reporte vacío no depende de Rules.
    const evaluaciones = conTarifa.length
      ? await this.ruleEvaluationService.evaluateRates({
          tenantId: ctx.tenantId,
          role: ctx.role,
          correlationId,
          items: conTarifa.map((c) => ({
            id: c.id,
            total: c.total,
            valorMin: c.tarifa.valorMin,
            valorTipico: c.tarifa.valorTipico,
            valorMax: c.tarifa.valorMax,
          })),
        })
      : { version: null, resultados: [] };

    const porId = new Map(evaluaciones.resultados.map((r) => [r.id, r]));
    const fueraDeRango = conTarifa
      .map((c) => ({ ...c, evaluacion: porId.get(c.id) }))
      .filter((c) => c.evaluacion && c.evaluacion.resultado !== 'DENTRO_DE_RANGO')
      .map(({ evaluacion, ...c }) => ({
        ...c,
        resultado: evaluacion.resultado,
        desviacionPorcentaje: evaluacion.desviacionPorcentaje,
      }));

    return {
      periodo: rango,
      reglasVersion: evaluaciones.version,
      totales: {
        cotizaciones: cotizaciones.length,
        evaluadas: conTarifa.length,
        sinTarifa: cotizaciones.length - conTarifa.length,
        fueraDeRango: fueraDeRango.length,
      },
      cotizaciones: fueraDeRango,
    };
  }
}

module.exports = TariffsUseCase;
module.exports.tarifaValida = tarifaValida;
