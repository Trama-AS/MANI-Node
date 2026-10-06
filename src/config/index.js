const ENVIRONMENTS = {
  development: 'DEV',
  qa: 'QA',
  production: 'PROD',
  test: 'TEST',
};

// Variables que cada ambiente necesita para operar correctamente.
// Los VALORES nunca viven aquí: solo se exige que existan en el entorno (.env / variables del contenedor).
const REQUIRED_VARS_BY_ENV = {
  development: [],
  test: [],
  qa: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  production: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
};

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function normalizeEnvironment(rawEnv) {
  const value = (rawEnv || 'development').trim().toLowerCase();
  if (!ENVIRONMENTS[value]) {
    throw new ConfigurationError(
      `NODE_ENV="${rawEnv}" no es válido. Valores permitidos: ${Object.keys(ENVIRONMENTS).join(', ')}.`
    );
  }
  return value;
}

const environment = normalizeEnvironment(process.env.NODE_ENV);

const config = {
  environment,
  envLabel: ENVIRONMENTS[environment],
  isProduction: environment === 'production',
  port: Number(process.env.PORT) || 3000,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  gatewayUrl: process.env.GATEWAY_URL,
  rulesServiceUrl: process.env.RULES_SERVICE_URL,
  dispatchServiceUrl: process.env.DISPATCH_SERVICE_URL,
};

// Valida que las variables requeridas por el ambiente actual estén presentes.
// No expone valores: solo reporta qué nombres de variable faltan.
function assertValid() {
  const requiredVars = REQUIRED_VARS_BY_ENV[config.environment] || [];
  const missing = requiredVars.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Faltan variables de entorno requeridas para el ambiente "${config.envLabel}": ${missing.join(', ')}.`
    );
  }
}

module.exports = { ...config, assertValid, ConfigurationError };
