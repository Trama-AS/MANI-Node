/**
 * Prueba de conexión a Supabase usando un endpoint exclusivo de service-role
 * (auth.admin.listUsers). Si respondiera también con la anon key, no estaríamos
 * probando realmente que la credencial de servicio es válida.
 */
class SupabaseConnectionChecker {
  constructor({ supabaseClientFactory }) {
    if (!supabaseClientFactory) {
      throw new Error('supabaseClientFactory es requerido para SupabaseConnectionChecker');
    }
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async check() {
    if (!this.supabaseClientFactory.isConfigured()) {
      return { configured: false, connected: false };
    }

    const client = this.supabaseClientFactory.getClient();
    const startedAt = Date.now();

    try {
      const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
      const latencyMs = Date.now() - startedAt;

      if (error) {
        return { configured: true, connected: false, latencyMs, error: error.message };
      }

      return { configured: true, connected: true, latencyMs };
    } catch (err) {
      return { configured: true, connected: false, latencyMs: Date.now() - startedAt, error: err.message };
    }
  }
}

module.exports = SupabaseConnectionChecker;
