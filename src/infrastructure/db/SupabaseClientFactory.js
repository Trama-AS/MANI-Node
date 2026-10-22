const { createClient } = require('@supabase/supabase-js');

/**
 * Crea y memoiza el cliente de Supabase usando la service-role key.
 * La URL y la key se leen exclusivamente desde config (que a su vez las lee de process.env):
 * ningún secreto vive en este archivo ni en el resto del código.
 */
class SupabaseClientFactory {
  constructor({ supabaseUrl, supabaseServiceRoleKey }) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseServiceRoleKey = supabaseServiceRoleKey;
    this.client = null;
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseServiceRoleKey);
  }

  getClient() {
    if (!this.isConfigured()) {
      return null;
    }

    if (!this.client) {
      this.client = createClient(this.supabaseUrl, this.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    return this.client;
  }
}

module.exports = SupabaseClientFactory;
