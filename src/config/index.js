const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  gatewayUrl: process.env.GATEWAY_URL,
  rulesServiceUrl: process.env.RULES_SERVICE_URL,
  dispatchServiceUrl: process.env.DISPATCH_SERVICE_URL,
};

module.exports = config;
