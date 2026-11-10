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

// Entero mayor o igual que cero (0 es un valor válido); ausente, vacío o inválido usa el de por omisión.
function nonNegativeIntFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

// Falla inyectable del push (SCRUM-1662): `siempre` (o vacío) falla siempre; un entero N falla los N primeros intentos
// de cada notificación y el siguiente entrega.
function pushMockFallasFromEnv() {
  const raw = String(process.env.PUSH_MOCK_FALLAS ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'siempre') return Number.POSITIVE_INFINITY;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
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
  // Reintentos de la entrega push de los eventos del servicio ante una falla pasajera (SCRUM-1662). La clave de
  // idempotencia es el id de la notificación, así que reintentar no duplica el aviso. 0 los desactiva.
  pushProviderRetries: nonNegativeIntFromEnv('PUSH_PROVIDER_RETRIES', 1),
  // Solo con PUSH_PROVIDER=mock_falla (ver FalibleMockPushProvider).
  pushMockFallas: pushMockFallasFromEnv(),
  // Falla inyectable del Storage de KYC (SCRUM-1662): lista de operaciones que fallan y cuántas llamadas funcionan antes.
  storageFalla: (process.env.STORAGE_FALLA || '')
    .split(',')
    .map((op) => op.trim())
    .filter(Boolean),
  storageFallaDespuesDe: nonNegativeIntFromEnv('STORAGE_FALLA_DESPUES_DE', 0),
  paymentProviderTimeoutMs: positiveIntFromEnv('PAYMENT_PROVIDER_TIMEOUT_MS', 10000),
  // Kafka (ADR-0029, SCRUM-889). Lista separada por comas de `host:puerto`. Sin ella el relay del outbox no arranca y los
  // eventos quedan pendientes en `outbox_evento`.
  kafkaBrokers: (process.env.KAFKA_BROKERS || '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean),
  kafkaClientId: process.env.KAFKA_CLIENT_ID || 'mani-core',
  outboxRelayIntervalMs: positiveIntFromEnv('OUTBOX_RELAY_INTERVAL_MS', 2000),
  outboxRelayBatchSize: positiveIntFromEnv('OUTBOX_RELAY_BATCH_SIZE', 50),
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

  // Las fallas inyectadas existen para probar en DEV, QA y CI: en producción detienen el arranque (SCRUM-1662).
  if (config.environment === 'production') {
    if (String(config.pushProvider).trim().toLowerCase() === 'mock_falla') {
      throw new ConfigurationError('PUSH_PROVIDER=mock_falla provoca fallas a propósito y no se permite en producción.');
    }
    if (config.storageFalla.length > 0) {
      throw new ConfigurationError('STORAGE_FALLA provoca fallas a propósito y no se permite en producción.');
    }
  }
}

module.exports = { ...config, assertValid, ConfigurationError };
