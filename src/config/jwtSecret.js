// Secreto de verificación de JWT (ADR-0031). Falla cerrado: un secreto ausente
// nunca degrada a un valor conocido, porque ese valor está en el repositorio y
// cualquiera podría firmar tokens válidos para cualquier tenant (SCRUM-1333).
const INSECURE_DEV_SECRET = 'mani-jwt-secret-shared-development-token-key-2026';

class JwtConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JwtConfigurationError';
  }
}

// Solo un NODE_ENV declarado explícitamente como development o test cuenta
// como entorno de desarrollo. Sin NODE_ENV (o con qa/production/staging) se
// exige el secreto real.
function isDevelopment(env = process.env) {
  const value = (env.NODE_ENV || '').trim().toLowerCase();
  return value === 'development' || value === 'test';
}

function resolveJwtSecret(env = process.env) {
  const secret = env.SUPABASE_JWT_SECRET;
  if (secret && secret.trim()) {
    return secret;
  }
  if (isDevelopment(env)) {
    console.warn('⚠️  SUPABASE_JWT_SECRET no configurado: se usa el secreto inseguro de desarrollo (solo NODE_ENV=development|test).');
    return INSECURE_DEV_SECRET;
  }
  throw new JwtConfigurationError(
    'SUPABASE_JWT_SECRET es obligatorio fuera de NODE_ENV=development|test: el servicio no arranca sin él (ADR-0031).'
  );
}

// /auth/dev-token firma tokens con el secreto real para cualquier tenant y rol
// que el llamador pida. Solo puede existir en desarrollo y pruebas locales.
function isDevTokenEnabled(env = process.env) {
  return isDevelopment(env);
}

module.exports = { resolveJwtSecret, isDevTokenEnabled, isDevelopment, JwtConfigurationError, INSECURE_DEV_SECRET };
