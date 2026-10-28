const PushProviderError = require('../../../domain/errors/PushProviderError');
const callProvider = require('../../providers/callProvider');

const CANAL = 'PUSH';
// Un evento del servicio no debe hacer esperar a quien lo originó: la notificación ya queda en la bandeja (se persiste
// antes de llamar al proveedor), así que un push que tarda no se reintenta y se informa como fallido.
const POLITICA_EVENTO = Object.freeze({ timeoutMs: 2000, retries: 0 });
const DESTINOS = ['CLIENTE', 'ALIADO', 'CONTRARIO'];

/**
 * Notifica un evento del servicio al participante que corresponde (SCRUM-882, SCRUM-884; reutiliza la frontera de
 * SCRUM-1423 y el proveedor de SCRUM-1428). Es el **evento funcional** que consume la frontera de notificación: no es un
 * segundo publicador, usa el mismo puerto `IPushProvider` y la misma tabla `notificacion` que la oferta de despacho.
 *
 * Reglas, comunes a todos los eventos:
 * - **C1, destinatario correcto:** `CLIENTE`, `ALIADO` o `CONTRARIO` (el otro participante de quien origina el evento).
 *   El destinatario sale de la solicitud en el tenant del JWT, nunca del cuerpo.
 * - **C2, nunca revierte ni duplica:** `execute` NO lanza. Un fallo del proveedor deja la notificación en la bandeja y
 *   se informa como FALLIDA; un fallo de cualquier otra causa se registra y se informa como ERROR. Repetir el mismo
 *   `claveEvento` no crea otra notificación ni otro push.
 * - **C3, sin fugas:** solo el cliente o el aliado de la solicitud reciben; un tercero, otro tenant o el propio autor del
 *   evento no. El payload no lleva datos personales ni el texto de ningún mensaje.
 */
class NotificarEventoServicioUseCase {
  constructor({
    notificacionRepository,
    pushProvider,
    politica = POLITICA_EVENTO,
    logger = (entrada) => console.warn(JSON.stringify(entrada)),
  }) {
    if (!notificacionRepository) throw new Error('notificacionRepository es requerido para NotificarEventoServicioUseCase');
    if (!pushProvider) throw new Error('pushProvider es requerido para NotificarEventoServicioUseCase');
    this.notificacionRepository = notificacionRepository;
    this.pushProvider = pushProvider;
    this.politica = { ...POLITICA_EVENTO, ...politica };
    this.logger = logger;
  }

  /**
   * @param {{ tenantId: string, userId: string, role?: string }} ctx sesión verificada de quien origina el evento
   * @param {{ solicitudId: string, destino: 'CLIENTE'|'ALIADO'|'CONTRARIO', tipo: string, claveEvento: string,
   *           payload?: object, correlationId?: string }} evento
   * @returns {Promise<{ estado: 'ENTREGADA'|'SIMULADA'|'FALLIDA'|'DUPLICADA'|'SIN_DESTINATARIO'|'ERROR', notificacionId?: string }>}
   */
  async execute(ctx, evento) {
    try {
      return await this.#notificar(ctx, evento);
    } catch (err) {
      // C2: la operación que originó el evento ya se confirmó; esto nunca la revierte.
      this.logger({
        event: 'notificacion.evento_servicio.error',
        tenant_id: ctx.tenantId,
        tipo: evento.tipo,
        clave_evento: evento.claveEvento,
        correlation_id: evento.correlationId,
        causa: err instanceof Error ? err.name : 'desconocida',
      });
      return { estado: 'ERROR' };
    }
  }

  async #notificar(ctx, { solicitudId, destino, tipo, claveEvento, payload = {}, correlationId }) {
    if (!DESTINOS.includes(destino)) throw new TypeError(`destino debe ser uno de ${DESTINOS.join(', ')}`);

    const participantes = await this.notificacionRepository.participantesDeSolicitud(ctx, solicitudId);
    if (!participantes) return { estado: 'SIN_DESTINATARIO' };

    const usuarioId = this.#destinatario(ctx, participantes, destino);
    // Sin destinatario (aliado aún sin asignar), o es quien originó el evento: no se notifica.
    if (!usuarioId || usuarioId === ctx.userId) return { estado: 'SIN_DESTINATARIO' };

    const contenido = { ...payload, requestId: solicitudId, categoria: participantes.categoria };
    const creada = await this.notificacionRepository.crearParaUsuario(ctx, {
      usuarioId,
      tipo,
      canal: CANAL,
      payload: contenido,
      claveEvento,
    });
    if (!creada) return { estado: 'SIN_DESTINATARIO' };
    // Reintento del mismo evento: ya estaba en la bandeja y el push no se repite.
    if (!creada.nueva) return { estado: 'DUPLICADA', notificacionId: creada.id };

    try {
      const entrega = await callProvider(
        ({ signal }) =>
          this.pushProvider.send({
            notificacionId: creada.id,
            tenantId: ctx.tenantId,
            usuarioId,
            tipo,
            payload: contenido,
            idempotencyKey: creada.id,
            correlationId,
            signal,
          }),
        { ...this.politica, ErrorClass: PushProviderError, proveedor: `El proveedor push ${this.pushProvider.name}` }
      );
      return { estado: entrega.estado, notificacionId: creada.id };
    } catch {
      return { estado: 'FALLIDA', notificacionId: creada.id };
    }
  }

  #destinatario(ctx, participantes, destino) {
    if (destino === 'CLIENTE') return participantes.clienteUsuarioId;
    if (destino === 'ALIADO') return participantes.aliadoUsuarioId;
    // CONTRARIO: el otro participante de quien origina el evento. Un tercero no es ninguno de los dos.
    if (ctx.userId === participantes.clienteUsuarioId) return participantes.aliadoUsuarioId;
    if (ctx.userId === participantes.aliadoUsuarioId) return participantes.clienteUsuarioId;
    return null;
  }
}

NotificarEventoServicioUseCase.POLITICA_EVENTO = POLITICA_EVENTO;
module.exports = NotificarEventoServicioUseCase;
