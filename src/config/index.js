const { INSECURE_DEV_SECRET } = require('./jwtSecret');

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
  qa: [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_ANON_KEY',
    'DATABASE_URL',
    'RULES_SERVICE_URL',
  ],
  production: [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_ANON_KEY',
    'DATABASE_URL',
    'RULES_SERVICE_URL',
  ],
};

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// Entero positivo desde una variable; un valor ausente, vacío o inválido usa el de por omisión.
function positiveIntFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
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
  // El respaldo de desarrollo es el MISMO que usa config/jwtSecret.js, que es
  // con el que /auth/validate-token verifica para el Gateway. Cuando eran dos
  // valores distintos, el Gateway aceptaba el token y el middleware
  // `authenticate` de Core lo rechazaba después: toda ruta autenticada quedaba
  // rota en local si no se fijaba SUPABASE_JWT_SECRET.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || (allowInsecureDevSecret ? INSECURE_DEV_SECRET : ''),
  gatewayUrl: process.env.GATEWAY_URL,
  rulesServiceUrl: process.env.RULES_SERVICE_URL,
  dispatchServiceUrl: process.env.DISPATCH_SERVICE_URL,
  // Proveedor de notificaciones push (HU-M09-06). Hoy solo existe `mock`; otro valor detiene el arranque.
  pushProvider: process.env.PUSH_PROVIDER || 'mock',
  // Proveedor de pagos (HU-M11-01). Hoy solo existe `mock` (sandbox sin dinero real); otro valor detiene el arranque.
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
  // Tiempo máximo de espera de cada proveedor externo (SCRUM-1240). Las credenciales de un proveedor real también
  // se leen aquí, desde process.env, y nunca se registran ni se devuelven.
  pushProviderTimeoutMs: positiveIntFromEnv('PUSH_PROVIDER_TIMEOUT_MS', 5000),
  paymentProviderTimeoutMs: positiveIntFromEnv('PAYMENT_PROVIDER_TIMEOUT_MS', 10000),
  // Página de Flutter que recibe al usuario desde el correo de recuperación (HU-M02-10). Debe estar en la lista de
  // redirecciones permitidas del proyecto de Supabase; sin ella el proveedor usa su Site URL.
  passwordRecoveryRedirectUrl: process.env.PASSWORD_RECOVERY_REDIRECT_URL,
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
