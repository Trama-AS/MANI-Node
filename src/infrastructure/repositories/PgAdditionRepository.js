const IAdditionRepository = require('../../domain/ports/IAdditionRepository');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { aliadoDeSesion, clienteActivoDeSesion, solicitudVisible } = require('./sesionActores');
const { avisoDeNotificacion } = require('./avisoDeNotificacion');
const { ADICIONES_ACEPTADAS_SQL } = require('./totalVigente');

// Tope de la PO (27-oct): las adiciones aceptadas no superan el 50 % del total de la cotización aceptada.
const TOPE_PORCENTAJE = 50;
// El cliente decide mientras el servicio está en ejecución o ya finalizado (la adición pudo quedar pendiente al
// finalizar); una solicitud cancelada ya no admite decisiones.
const ESTADOS_DECISION = ['EN_EJECUCION', 'FINALIZADA'];

const COLUMNAS = `id, solicitud_id, cotizacion_id, motivo, valor_mano_obra, valor_materiales, tiempo_adicional_minutos,
  estado, comentario_cliente, respondida_at, created_at`;

const aCentavos = (valor) => Math.round(Number(valor) * 100);
const aPesos = (centavos) => centavos / 100;

function toAddition(row) {
  const manoObra = aCentavos(row.valor_mano_obra);
  const materiales = aCentavos(row.valor_materiales);
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    cotizacionId: row.cotizacion_id,
    motivo: row.motivo,
    valorManoObra: aPesos(manoObra),
    valorMateriales: aPesos(materiales),
    total: aPesos(manoObra + materiales),
    tiempoAdicionalMinutos: row.tiempo_adicional_minutos ?? null,
    estado: row.estado,
    comentarioCliente: row.comentario_cliente ?? null,
    respondidaEn: row.respondida_at ?? null,
    creadaEn: row.created_at,
  };
}

const noEncontrada = () => new NotFoundError('MANI-ADI-404: solicitud no encontrada', 'MANI-ADI-404');
const adicionNoEncontrada = () => new NotFoundError('MANI-ADI-404: adición no encontrada', 'MANI-ADI-404');
const noAsignado = () =>
  new ForbiddenError('MANI-ADI-403A: solo el aliado asignado a la solicitud puede pedir una adición', 'MANI-ADI-403A');
const pendienteExistente = () =>
  new ConflictError('MANI-ADI-409P: ya hay una adición pendiente de decisión del cliente', 'MANI-ADI-409P');

function superaTope(resumen, centavosNuevos) {
  const disponible = aPesos(Math.max(resumen.topeCentavos - resumen.aceptadasCentavos, 0));
  return new ValidationError(
    `MANI-ADI-400T: la adición supera el tope: las adiciones aceptadas no pueden pasar del ${TOPE_PORCENTAJE} % ` +
      `de la cotización aceptada (disponible: ${disponible}, solicitado: ${aPesos(centavosNuevos)})`,
    'MANI-ADI-400T'
  );
}

/**
 * Cotización aceptada vigente (la versión más reciente) y lo ya aceptado en adiciones, en centavos.
 * @returns {Promise<{ cotizacionId: string, cotizacionCentavos: number, aceptadasCentavos: number,
 *   topeCentavos: number } | null>} null si la solicitud no tiene una cotización aceptada
 */
async function totales(client, tenantId, solicitudId) {
  const { rows } = await client.query(
    `SELECT cot.id, (cot.valor_mano_obra + cot.valor_materiales) AS total, ${ADICIONES_ACEPTADAS_SQL} AS aceptadas
     FROM cotizacion cot
     WHERE cot.solicitud_id = $1 AND cot.tenant_id = $2 AND cot.estado = 'ACEPTADA'
     ORDER BY cot.version DESC
     LIMIT 1`,
    [solicitudId, tenantId]
  );
  if (rows.length === 0) return null;
  const cotizacionCentavos = aCentavos(rows[0].total);
  return {
    cotizacionId: rows[0].id,
    cotizacionCentavos,
    aceptadasCentavos: aCentavos(rows[0].aceptadas),
    topeCentavos: Math.floor((cotizacionCentavos * TOPE_PORCENTAJE) / 100),
  };
}

/** Total vigente que ven el cliente y el aliado, y que cobra el pago. */
function resumenPublico(t) {
  if (!t) return null;
  return {
    cotizacionId: t.cotizacionId,
    totalCotizacion: aPesos(t.cotizacionCentavos),
    totalAdicionesAceptadas: aPesos(t.aceptadasCentavos),
    totalVigente: aPesos(t.cotizacionCentavos + t.aceptadasCentavos),
    topeAdiciones: aPesos(t.topeCentavos),
    disponibleParaAdiciones: aPesos(Math.max(t.topeCentavos - t.aceptadasCentavos, 0)),
  };
}

/**
 * Adiciones sobre `pg` dentro de una transacción con withTenantContext (ADR-0032). Toda consulta filtra por el tenant
 * del JWT además de RLS. La fila de la solicitud se bloquea (FOR UPDATE): dos pedidos simultáneos no dejan dos
 * adiciones pendientes, y dos decisiones simultáneas no superan el tope entre las dos.
 */
class PgAdditionRepository extends IAdditionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgAdditionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async solicitar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliadoId = await aliadoDeSesion(client, ctx, noAsignado);

      const solicitud = await client.query(
        'SELECT estado, aliado_id FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [datos.solicitudId, ctx.tenantId]
      );
      if (solicitud.rows.length === 0) throw noEncontrada();
      const { estado, aliado_id: asignado } = solicitud.rows[0];
      if (asignado !== aliadoId) throw noAsignado();
      if (estado !== 'EN_EJECUCION') {
        throw new ConflictError(
          `MANI-ADI-409E: solo se pide una adición con el servicio en ejecución (estado ${estado})`,
          'MANI-ADI-409E'
        );
      }

      const t = await totales(client, ctx.tenantId, datos.solicitudId);
      if (!t) {
        throw new ConflictError(
          'MANI-ADI-409C: el servicio no tiene una cotización aceptada sobre la cual pedir la adición',
          'MANI-ADI-409C'
        );
      }
      const pendientes = await client.query(
        "SELECT 1 FROM adicion_servicio WHERE solicitud_id = $1 AND tenant_id = $2 AND estado = 'PENDIENTE'",
        [datos.solicitudId, ctx.tenantId]
      );
      if (pendientes.rows.length > 0) throw pendienteExistente();

      const nuevos = aCentavos(datos.valorManoObra) + aCentavos(datos.valorMateriales);
      if (t.aceptadasCentavos + nuevos > t.topeCentavos) throw superaTope(t, nuevos);

      let creada;
      try {
        creada = await client.query(
          `INSERT INTO adicion_servicio (tenant_id, solicitud_id, cotizacion_id, aliado_id, motivo, valor_mano_obra,
                                         valor_materiales, tiempo_adicional_minutos)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${COLUMNAS}`,
          [
            ctx.tenantId,
            datos.solicitudId,
            t.cotizacionId,
            aliadoId,
            datos.motivo,
            datos.valorManoObra,
            datos.valorMateriales,
            datos.tiempoAdicionalMinutos,
          ]
        );
      } catch (err) {
        // Respaldo del índice ux_adicion_servicio_pendiente si otra transacción ganó la carrera.
        if (err && err.code === '23505') throw pendienteExistente();
        throw err;
      }
      const adicion = toAddition(creada.rows[0]);

      // QS-12: la adición queda en la bitácora del servicio.
      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, 'ADICION_SOLICITADA', $4)`,
        [
          ctx.tenantId,
          datos.solicitudId,
          ctx.userId,
          `Adición solicitada: ${adicion.motivo} (mano de obra ${adicion.valorManoObra}, materiales ${adicion.valorMateriales}, total ${adicion.total})`,
        ]
      );
      // El cliente se entera de que tiene una adición por decidir (SCRUM-884); el push se entrega tras el commit.
      const aviso = await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload, clave_evento)
         SELECT $1, cl.usuario_id, 'ADICION_SOLICITADA', 'PUSH', $3::jsonb, $4
         FROM solicitud s JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         WHERE s.id = $2 AND s.tenant_id = $1
         RETURNING id`,
        [
          ctx.tenantId,
          datos.solicitudId,
          JSON.stringify({ requestId: datos.solicitudId, adicionId: adicion.id, total: adicion.total }),
          `adicion-solicitada:${adicion.id}`,
        ]
      );

      return { adicion, resumen: resumenPublico(t), ...avisoDeNotificacion(aviso) };
    });
  }

  async listarPorSolicitud(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await solicitudVisible(client, ctx, solicitudId, noEncontrada);

      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM adicion_servicio
         WHERE solicitud_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC`,
        [solicitudId, ctx.tenantId]
      );
      return { adiciones: rows.map(toAddition), resumen: resumenPublico(await totales(client, ctx.tenantId, solicitudId)) };
    });
  }

  async responder(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivoDeSesion(
        client,
        ctx,
        () => new ForbiddenError('MANI-ADI-403C: solo un cliente activo decide sobre una adición', 'MANI-ADI-403C')
      );

      const fila = await client.query(
        `SELECT ad.estado, ad.aliado_id, ad.valor_mano_obra, ad.valor_materiales, s.id AS solicitud_id, s.cliente_id,
                s.estado AS estado_solicitud
         FROM adicion_servicio ad
         JOIN solicitud s ON s.id = ad.solicitud_id AND s.tenant_id = ad.tenant_id
         WHERE ad.id = $1 AND ad.tenant_id = $2
         FOR UPDATE OF ad, s`,
        [datos.adicionId, ctx.tenantId]
      );
      // Una adición de otro cliente responde igual que una inexistente: no se revela que existe.
      if (fila.rows.length === 0 || fila.rows[0].cliente_id !== clienteId) throw adicionNoEncontrada();
      const actual = fila.rows[0];
      if (actual.estado !== 'PENDIENTE') {
        throw new ConflictError(`MANI-ADI-409R: la adición ya fue decidida (estado ${actual.estado})`, 'MANI-ADI-409R');
      }
      if (!ESTADOS_DECISION.includes(actual.estado_solicitud)) {
        throw new ConflictError(
          `MANI-ADI-409E: la solicitud en estado ${actual.estado_solicitud} no admite decisiones sobre adiciones`,
          'MANI-ADI-409E'
        );
      }

      if (datos.decision.accion === 'ACEPTAR') {
        const t = await totales(client, ctx.tenantId, actual.solicitud_id);
        const nuevos = aCentavos(actual.valor_mano_obra) + aCentavos(actual.valor_materiales);
        if (t && t.aceptadasCentavos + nuevos > t.topeCentavos) throw superaTope(t, nuevos);
      }

      const actualizada = await client.query(
        `UPDATE adicion_servicio
         SET estado = $1, comentario_cliente = NULLIF($2, ''), respondida_por = $3, respondida_at = now()
         WHERE id = $4 AND tenant_id = $5
         RETURNING ${COLUMNAS}`,
        [datos.decision.adicion, datos.comentario, ctx.userId, datos.adicionId, ctx.tenantId]
      );
      const adicion = toAddition(actualizada.rows[0]);

      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          ctx.tenantId,
          actual.solicitud_id,
          ctx.userId,
          datos.decision.evento,
          datos.comentario ? `Adición de ${adicion.total}: ${datos.comentario}` : `Adición de ${adicion.total}`,
        ]
      );
      const aviso = await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload, clave_evento)
         SELECT $1, a.usuario_id, 'RESPUESTA_ADICION', 'PUSH', $3::jsonb, $4
         FROM aliado a WHERE a.id = $2 AND a.tenant_id = $1
         RETURNING id`,
        [
          ctx.tenantId,
          actual.aliado_id,
          JSON.stringify({ requestId: actual.solicitud_id, adicionId: adicion.id, decision: datos.decision.accion }),
          `respuesta-adicion:${adicion.id}`,
        ]
      );

      const resumen = resumenPublico(await totales(client, ctx.tenantId, actual.solicitud_id));
      return { adicion, resumen, ...avisoDeNotificacion(aviso) };
    });
  }
}

module.exports = PgAdditionRepository;
