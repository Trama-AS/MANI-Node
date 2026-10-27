/**
 * Puerto de la mensajería cliente-aliado por servicio (HU-M09-02, RF-20). Core es el dueño del hilo (SAD §12). Solo
 * participan el cliente dueño de la solicitud y el aliado asignado; para cualquier otro usuario, del mismo tenant o de
 * otro, el hilo responde como inexistente. Todo corre con el contexto verificado del JWT (ADR-0032).
 */
class IMessageRepository {
  /**
   * Guarda un mensaje del participante de la sesión. Un reintento con la misma clave devuelve el ya guardado.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx
   * @param {{ solicitudId: string, contenido: string, claveIdempotencia: string|null }} _datos contenido ya validado
   * @returns {Promise<{ mensaje: object, creado: boolean }>}
   */
  async enviar(_ctx, _datos) {
    throw new Error('Método enviar() no implementado en IMessageRepository');
  }

  /**
   * Mensajes del hilo ordenados del más antiguo al más reciente. Sin `despuesDe` devuelve los últimos `limite`;
   * con `despuesDe` (id del último mensaje que el cliente ya tiene) devuelve solo los posteriores.
   * @returns {Promise<{ mensajes: object[] }>}
   */
  async listar(_ctx, _datos) {
    throw new Error('Método listar() no implementado en IMessageRepository');
  }
}

module.exports = IMessageRepository;
