const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '../../../src/config/index.js');

function withEnv(envOverrides, fn) {
  const original = { ...process.env };
  Object.keys(envOverrides).forEach((key) => {
    if (envOverrides[key] === undefined) delete process.env[key];
    else process.env[key] = envOverrides[key];
  });

  delete require.cache[CONFIG_PATH];

  try {
    return fn(require(CONFIG_PATH));
  } finally {
    process.env = original;
    delete require.cache[CONFIG_PATH];
  }
}

test('usa development por defecto cuando NODE_ENV no está definido', () => {
  withEnv({ NODE_ENV: undefined }, (config) => {
    assert.equal(config.environment, 'development');
    assert.equal(config.envLabel, 'DEV');
  });
});

test('reconoce el ambiente qa y expone su etiqueta', () => {
  withEnv({ NODE_ENV: 'qa' }, (config) => {
    assert.equal(config.environment, 'qa');
    assert.equal(config.envLabel, 'QA');
  });
});

test('rechaza un NODE_ENV no soportado', () => {
  assert.throws(() => withEnv({ NODE_ENV: 'staging-raro' }, (c) => c), /no es válido/);
});

test('assertValid no exige SUPABASE_* en development', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      PORT: '3000',
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    (config) => {
      assert.doesNotThrow(() => config.assertValid());
    }
  );
});

test('assertValid exige SUPABASE_* y SUPABASE_JWT_SECRET en qa y reporta solo los nombres faltantes', () => {
  withEnv(
    {
      NODE_ENV: 'qa',
      PORT: '3000',
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_JWT_SECRET: undefined,
      SUPABASE_ANON_KEY: undefined,
    },
    (config) => {
      assert.throws(
        () => config.assertValid(),
        (err) => {
          assert.match(err.message, /SUPABASE_URL/);
          assert.match(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
          assert.match(err.message, /SUPABASE_JWT_SECRET/);
          assert.match(err.message, /SUPABASE_ANON_KEY/);
          return true;
        }
      );
    }
  );
});

test('assertValid pasa en qa cuando las variables requeridas existen', () => {
  withEnv(
    {
      NODE_ENV: 'qa',
      PORT: '3000',
      SUPABASE_URL: 'https://qa-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'qa-key',
      SUPABASE_JWT_SECRET: 'qa-jwt-secret',
      SUPABASE_ANON_KEY: 'qa-anon-key',
    },
    (config) => {
      assert.doesNotThrow(() => config.assertValid());
    }
  );
});

// B6: el secreto fijo de desarrollo solo es seguro sin un proyecto Supabase
// real detrás; si SUPABASE_URL apunta a uno, usarlo permitiría falsificar
// tokens válidos para ese proyecto con un secreto conocido en el repositorio.
test('en development, si SUPABASE_URL está configurada, NO cae al secreto JWT inseguro', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://real-project.supabase.co',
      SUPABASE_JWT_SECRET: undefined,
    },
    (config) => {
      assert.equal(config.supabaseJwtSecret, '');
    }
  );
});

test('en test, si SUPABASE_URL está configurada, NO cae al secreto JWT inseguro', () => {
  withEnv(
    {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://real-project.supabase.co',
      SUPABASE_JWT_SECRET: undefined,
    },
    (config) => {
      assert.equal(config.supabaseJwtSecret, '');
    }
  );
});

test('en development sin SUPABASE_URL, sí usa el secreto JWT inseguro fijo (modo 100% en memoria)', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      SUPABASE_URL: undefined,
      SUPABASE_JWT_SECRET: undefined,
    },
    (config) => {
      assert.equal(config.supabaseJwtSecret, 'dev-jwt-secret-insecure-32chars!!');
    }
  );
});

test('assertValid exige SUPABASE_JWT_SECRET en development cuando SUPABASE_URL está configurada', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://real-project.supabase.co',
      SUPABASE_JWT_SECRET: undefined,
    },
    (config) => {
      assert.throws(
        () => config.assertValid(),
        (err) => {
          assert.match(err.message, /SUPABASE_JWT_SECRET/);
          return true;
        }
      );
    }
  );
});

test('assertValid pasa en development cuando SUPABASE_URL y SUPABASE_JWT_SECRET están ambas configuradas', () => {
  withEnv(
    {
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://real-project.supabase.co',
      SUPABASE_JWT_SECRET: 'un-secreto-real',
    },
    (config) => {
      assert.doesNotThrow(() => config.assertValid());
    }
  );
});
