/**
 * SCRUM-878 (US-04.5.2 / HU-M08-05): cálculo de penalización por cancelación tardía según política vigente por tenant.
 *
 * Reglas de dominio:
 * - C2: si el tenant no tiene política activa (`activa = false` o sin registro) o el valor es 0,
 *   no se cobra penalización arbitraria (`aplicaPenalizacion: false, montoPenalizacion: 0`).
 * - C1: con política activa, si la solicitud tiene aliado asignado, está en uno de `estados_gravables`
 *   y el tiempo transcurrido desde la asignación (o última transición gravable) supera `ventana_gratuita_minutos`,
 *   se calcula y muestra la penalización (`MONTO_FIJO` o `PORCENTAJE` sobre la cotización vigente).
 * - C3: toda lectura se acota a `tenant_id` dentro de `runInTenantContext`.
 */
async function calcularPenalizacionCancelacion(client, tenantId, sol) {
  let polRows = [];
  try {
    const res = await client.query(
      `SELECT activa, ventana_gratuita_minutos, tipo_cobro, valor, estados_gravables
       FROM politica_cancelacion_tenant
       WHERE tenant_id = $1`,
      [tenantId]
    );
    polRows = res.rows;
  } catch (err) {
    // Si la tabla aún no fue migrada en un entorno parcial, falla seguro sin cobrar arbitrariamente (C2).
    if (err && err.code === '42P01') {
      polRows = [];
    } else {
      throw err;
    }
  }

  if (polRows.length === 0 || !polRows[0].activa || Number(polRows[0].valor) <= 0) {
    return {
      solicitudId: sol.id,
      estadoActual: sol.estado,
      aplicaPenalizacion: false,
      montoPenalizacion: 0,
      moneda: 'COP',
      razon: 'SIN_POLITICA_VIGENTE',
      politicaActiva: false,
      ventanaGratuitaMinutos: polRows[0] ? Number(polRows[0].ventana_gratuita_minutos) : 15,
    };
  }

  const pol = polRows[0];
  const ventanaMinutos = Number(pol.ventana_gratuita_minutos || 0);
  const estadosGravables = Array.isArray(pol.estados_gravables)
    ? pol.estados_gravables
    : ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'];

  if (!sol.aliado_id || !estadosGravables.includes(sol.estado)) {
    return {
      solicitudId: sol.id,
      estadoActual: sol.estado,
      aplicaPenalizacion: false,
      montoPenalizacion: 0,
      moneda: 'COP',
      razon: !sol.aliado_id ? 'SIN_ALIADO_ASIGNADO' : 'ESTADO_EXENTO_SEGUN_POLITICA',
      politicaActiva: true,
      tipoCobro: pol.tipo_cobro,
      valorPolitica: Number(pol.valor),
      ventanaGratuitaMinutos: ventanaMinutos,
    };
  }

  // Referencia temporal de asignación del aliado para medir la ventana gratuita:
  const hito = await client.query(
    `SELECT COALESCE(
       (SELECT ev.timestamp FROM evento_servicio ev
        WHERE ev.solicitud_id = $1 AND ev.tenant_id = $2 AND ev.tipo_evento = 'SOLICITUD_ASIGNADA'
        ORDER BY ev.timestamp DESC LIMIT 1),
       $3::timestamptz
     ) AS referencia,
     EXTRACT(EPOCH FROM (now() - COALESCE(
       (SELECT ev.timestamp FROM evento_servicio ev
        WHERE ev.solicitud_id = $1 AND ev.tenant_id = $2 AND ev.tipo_evento = 'SOLICITUD_ASIGNADA'
        ORDER BY ev.timestamp DESC LIMIT 1),
       $3::timestamptz
     ))) / 60.0 AS minutos_transcurridos`,
    [sol.id, tenantId, sol.updated_at || sol.created_at || new Date()]
  );

  const minutosTranscurridos = Math.max(0, Number(hito.rows[0]?.minutos_transcurridos || 0));
  if (ventanaMinutos > 0 && minutosTranscurridos < ventanaMinutos) {
    return {
      solicitudId: sol.id,
      estadoActual: sol.estado,
      aplicaPenalizacion: false,
      montoPenalizacion: 0,
      moneda: 'COP',
      razon: 'DENTRO_DE_VENTANA_GRATUITA',
      politicaActiva: true,
      tipoCobro: pol.tipo_cobro,
      valorPolitica: Number(pol.valor),
      ventanaGratuitaMinutos: ventanaMinutos,
      minutosTranscurridos: Number(minutosTranscurridos.toFixed(2)),
    };
  }

  let montoPenalizacion = Number(pol.valor);
  let baseCotizacion = null;
  if (pol.tipo_cobro === 'PORCENTAJE') {
    const cot = await client.query(
      `SELECT (valor_mano_obra + valor_materiales)::float8 AS total
       FROM cotizacion
       WHERE solicitud_id = $1 AND tenant_id = $2
       ORDER BY (estado = 'ACEPTADA') DESC, version DESC
       LIMIT 1`,
      [sol.id, tenantId]
    );
    baseCotizacion = cot.rows.length > 0 ? Number(cot.rows[0].total) : 0;
    montoPenalizacion = Number(((baseCotizacion * Number(pol.valor)) / 100).toFixed(2));
  }

  const aplicaPenalizacion = montoPenalizacion > 0;
  return {
    solicitudId: sol.id,
    estadoActual: sol.estado,
    aplicaPenalizacion,
    montoPenalizacion,
    moneda: 'COP',
    razon: aplicaPenalizacion ? 'CANCELACION_TARDIA_SEGUN_POLITICA' : 'SIN_BASE_COTIZADA_PARA_PORCENTAJE',
    politicaActiva: true,
    tipoCobro: pol.tipo_cobro,
    valorPolitica: Number(pol.valor),
    baseCotizacion,
    ventanaGratuitaMinutos: ventanaMinutos,
    minutosTranscurridos: Number(minutosTranscurridos.toFixed(2)),
  };
}

module.exports = { calcularPenalizacionCancelacion };
