const { COMISION_MAXIMA, REGLAS_POR_OMISION } = require('../../domain/rules/tenantRulesDefaults');
const { registrarPagoEnBitacora } = require('./bitacoraPago');

// La comisión tiene una sola fuente: las reglas del tenant (SCRUM-1366). Sin reglas guardadas rige el valor por omisión.
const COMISION_POR_DEFECTO = REGLAS_POR_OMISION.comision.porcentaje;

const aCentavos = (valor) => Math.round(Number(valor) * 100);
const aPesos = (centavos) => centavos / 100;

/**
 * Porcentaje de la regla VIGENTE del tenant, o el valor por omisión si no tiene reglas guardadas. Una regla sin
 * porcentaje da NaN, no 0: quien liquida la trata como inválida y no cobra una comisión que nadie configuró.
 */
async function comisionVigente(client, tenantId) {
  const { rows } = await client.query(
    "SELECT reglas -> 'comision' ->> 'porcentaje' AS porcentaje FROM regla_tenant WHERE tenant_id = $1 AND estado = 'VIGENTE'",
    [tenantId]
  );
  if (rows.length === 0) return COMISION_POR_DEFECTO;
  return rows[0].porcentaje === null ? NaN : Number(rows[0].porcentaje);
}

/** Descuenta la comisión en centavos, sin errores de punto flotante: bruto = comisión + neto. */
function calcularLiquidacion(montoBruto, porcentaje) {
  const bruto = aCentavos(montoBruto);
  const comision = Math.round((bruto * Number(porcentaje)) / 100);
  return { bruto: aPesos(bruto), comision: aPesos(comision), neto: aPesos(bruto - comision) };
}

/**
 * Retiene el monto de un pago APROBADO (SCRUM-891). Se llama con el cliente de la MISMA transacción que registra el
 * pago, así el pago y su retención nacen juntos o no nacen. No escribe en `transaccion_evento` (889): ese registro
 * conserva un evento por pago; la retención y la liquidación llevan su propia fecha y no se modifican en silencio. Un pago rechazado o pendiente no retiene nada (C2).
 */
async function retenerPago(client, ctx, pago) {
  if (pago.estado !== 'APROBADO') return null;
  const { rows } = await client.query(
    `INSERT INTO retencion_fondos (tenant_id, pago_id, solicitud_id, aliado_id, monto, moneda)
     SELECT $1, $2, cot.solicitud_id, cot.aliado_id, $3, $4
     FROM cotizacion cot
     WHERE cot.id = $5 AND cot.tenant_id = $1
     ON CONFLICT (pago_id) DO NOTHING
     RETURNING id, solicitud_id`,
    [ctx.tenantId, pago.id, pago.monto, pago.moneda, pago.cotizacionId]
  );
  if (rows.length === 0) return null;
  // Solo la primera vez que se aprueba el pago (la retención es única por pago): el pago aprobado queda en la
  // bitácora de la solicitud junto con su retención, en la misma transacción.
  await registrarPagoEnBitacora(client, ctx, rows[0].solicitud_id);
  return rows[0].id;
}

/**
 * Libera la retención de la solicitud y liquida al aliado (SCRUM-892 y 893). Solo se llama cuando la solicitud
 * acaba de pasar a FINALIZADA, en la misma transacción: sin esa condición verificada no se libera (C2 de 892). Si la
 * solicitud no tiene retención (no se pagó o ya se liberó), no hace nada.
 * @returns {Promise<object|null>} la liquidación generada, o null si no había nada que liberar
 */
async function liberarYLiquidar(client, ctx, solicitudId) {
  const { rows } = await client.query(
    `SELECT id, pago_id, aliado_id, monto, moneda
     FROM retencion_fondos
     WHERE solicitud_id = $1 AND tenant_id = $2 AND estado = 'RETENIDA'
     FOR UPDATE`,
    [solicitudId, ctx.tenantId]
  );
  const liquidaciones = [];
  for (const ret of rows) {
    const porcentaje = await comisionVigente(client, ctx.tenantId);
    // Una regla fuera de rango no debería existir (se valida al guardarla); si apareciera, no se liquida y la
    // retención se queda retenida, en lugar de liberar con un cálculo inválido (C2 de 893).
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > COMISION_MAXIMA) continue;

    await client.query(
      "UPDATE retencion_fondos SET estado = 'LIBERADA', liberada_at = now() WHERE id = $1 AND tenant_id = $2",
      [ret.id, ctx.tenantId]
    );
    const { bruto, comision, neto } = calcularLiquidacion(ret.monto, porcentaje);
    const creada = await client.query(
      `INSERT INTO liquidacion (tenant_id, retencion_id, pago_id, solicitud_id, aliado_id, monto_bruto,
                                porcentaje_comision, comision, monto_neto, moneda)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [ctx.tenantId, ret.id, ret.pago_id, solicitudId, ret.aliado_id, bruto, porcentaje, comision, neto, ret.moneda]
    );
    liquidaciones.push({ id: creada.rows[0].id, montoBruto: bruto, comision, montoNeto: neto, porcentaje });
  }
  return liquidaciones.length > 0 ? liquidaciones : null;
}

module.exports = { retenerPago, liberarYLiquidar, comisionVigente, calcularLiquidacion, COMISION_POR_DEFECTO };
