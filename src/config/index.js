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
  qa: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'SUPABASE_ANON_KEY', 'DATABASE_URL'],
  production: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'SUPABASE_ANON_KEY', 'DATABASE_URL'],
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

// Si SUPABASE_URL está configurada, los JWT que emita Core (o los reales de
// Supabase Auth) se verifican contra ese proyecto concreto. El secreto fijo
// de desarrollo solo es seguro cuando NO hay un proyecto Supabase real detrás
// (B6): usarlo con un SUPABASE_URL real permitiría falsificar tokens válidos
// para ese proyecto con un secreto público conocido en el repositorio.
const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
const allowInsecureDevSecret =
  !hasSupabaseUrl && (environment === 'development' || environment === 'test');

const config = {
  environment,
  envLabel: ENVIRONMENTS[environment],
  isProduction: environment === 'production',
  port: Number(process.env.PORT) || 3000,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Clave pública, usada SOLO para el cliente desechable de sign-in (ver
  // SupabaseAuthIdentityService) — nunca para operaciones con service-role.
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  // Conexión directa a PostgreSQL (pg). Solo para operaciones que necesitan una
  // transacción real, como el reemplazo atómico de categorías del aliado (SCRUM-1071).
  databaseUrl: process.env.DATABASE_URL,
  supabaseJwtSecret:
    process.env.SUPABASE_JWT_SECRET || (allowInsecureDevSecret ? 'dev-jwt-secret-insecure-32chars!!' : ''),
  gatewayUrl: process.env.GATEWAY_URL,
  rulesServiceUrl: process.env.RULES_SERVICE_URL,
  dispatchServiceUrl: process.env.DISPATCH_SERVICE_URL,
};

// Valida que las variables requeridas por el ambiente actual estén presentes.
// No expone valores: solo reporta qué nombres de variable faltan.
function assertValid() {
  const requiredVars = [...(REQUIRED_VARS_BY_ENV[config.environment] || [])];
  // SUPABASE_URL puede configurarse en development/test (apuntando a un
  // proyecto Supabase real) sin pasar por la lista qa/production; en ese caso
  // el secreto JWT real sigue siendo obligatorio sin importar el ambiente.
  if (hasSupabaseUrl && !requiredVars.includes('SUPABASE_JWT_SECRET')) {
    requiredVars.push('SUPABASE_JWT_SECRET');
  }
  const missing = requiredVars.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Faltan variables de entorno requeridas para el ambiente "${config.envLabel}": ${missing.join(', ')}.`
    );
  }
}

module.exports = { ...config, assertValid, ConfigurationError };
