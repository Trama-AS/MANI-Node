/**
 * Interfaz / Puerto de Dominio para persistencia de la tabla `sitio`
 * (migrado de registrar_cliente_persona_natural, US-02.2.1-M2.2): el primer
 * domicilio/hogar del cliente, creado solo si el registro envía
 * `direccionHogar`. `zona` es un catálogo global compartido entre tenants
 * (no tiene tenant_id en el esquema, ver 01-schema.sql) -- por eso
 * `findFirstActiveZonaId()` no recibe tenantId, igual que hacía la función
 * PL/pgSQL legacy (`SELECT id FROM zona WHERE estado = 'ACTIVO' LIMIT 1`).
 */
class ISitioRepository {
  /** @returns {Promise<string|null>} id de cualquier zona activa, o null si no hay ninguna. */
  async findFirstActiveZonaId() {
    throw new Error('Método findFirstActiveZonaId() no implementado en ISitioRepository');
  }

  async create(_sitio) {
    throw new Error('Método create() no implementado en ISitioRepository');
  }

  /** Compensación (B3): deshace create() si un paso posterior del registro falla. */
  async deleteByClienteId(_tenantId, _clienteId) {
    throw new Error('Método deleteByClienteId() no implementado en ISitioRepository');
  }
}

module.exports = ISitioRepository;
