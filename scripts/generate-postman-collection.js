const fs = require('node:fs');
const path = require('node:path');
const Converter = require('openapi-to-postmanv2');

const SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi', 'core.yaml');
const OUTPUT_PATH = path.join(__dirname, '..', 'postman', 'MANI-Core.postman_collection.json');

const CONVERT_OPTIONS = {
  folderStrategy: 'Tags',
  requestParametersResolution: 'Example',
  exampleParametersResolution: 'Example',
  includeAuthInfoInExample: false,
  collapseFolders: false,
};

/**
 * Encuentra un request-item en la colección por su path (array de segmentos de URL).
 */
function findItemByPath(collection, urlPath) {
  for (const folder of collection.item) {
    for (const item of folder.item) {
      if (JSON.stringify(item.request.url.path) === JSON.stringify(urlPath)) {
        return item;
      }
    }
  }
  throw new Error(`No se encontró ningún request con path ${urlPath.join('/')}`);
}

function setHeaderValue(headers, key, value) {
  const header = headers.find((h) => h.key === key);
  if (header) header.value = value;
}

/**
 * La conversión automática desde OpenAPI solo produce paths/métodos/esquemas con
 * valores de ejemplo estáticos. Para que la colección "recorra en secuencia" el
 * flujo de identidad (registrar → login → refresh → logout) hace falta encadenar
 * variables entre requests: esto agrega justo ese pegamento, sin introducir
 * asserts de negocio (eso es la siguiente subtarea del pipeline Postman/Newman).
 */
function wireUpIdentityFlow(collection) {
  collection.variable.push(
    { key: 'tenantId', value: 'trama-demo', type: 'string' },
    { key: 'allyEmail', value: '', type: 'string' },
    { key: 'allyPassword', value: 'Cambiar123!', type: 'string' },
    { key: 'accessToken', value: '', type: 'string' },
    { key: 'refreshToken', value: '', type: 'string' }
  );

  // Reordena los folders generados por tag para que el registro ocurra antes
  // del login: el login usa las credenciales que acabamos de crear.
  const allyFolder = collection.item.find((f) => f.name === 'Ally Registration');
  const authFolder = collection.item.find((f) => f.name === 'Auth');
  collection.item = [allyFolder, authFolder];

  // --- POST /auth/register/ally ---
  const register = findItemByPath(collection, ['auth', 'register', 'ally']);
  setHeaderValue(register.request.header, 'X-Tenant-Id', '{{tenantId}}');
  register.request.body.raw = JSON.stringify(
    {
      fullName: 'María Fernanda Rojas',
      email: '{{allyEmail}}',
      password: '{{allyPassword}}',
      phone: '+573001234567',
      documentType: 'CC',
      documentNumber: '1020304050',
    },
    null,
    2
  );
  register.event.push(
    {
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          "// Email único por corrida para no chocar con EMAIL_ALREADY_REGISTERED",
          "pm.collectionVariables.set('allyEmail', `aliado.${Date.now()}@mani.test`);",
        ],
      },
    },
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'if (pm.response.code === 201) {',
          "  const body = pm.response.json();",
          "  pm.collectionVariables.set('accessToken', body.tokens.accessToken);",
          "  pm.collectionVariables.set('refreshToken', body.tokens.refreshToken);",
          '}',
        ],
      },
    }
  );

  // --- POST /auth/login ---
  const login = findItemByPath(collection, ['auth', 'login']);
  setHeaderValue(login.request.header, 'X-Tenant-Id', '{{tenantId}}');
  login.request.body.raw = JSON.stringify({ email: '{{allyEmail}}', password: '{{allyPassword}}' }, null, 2);
  login.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        'if (pm.response.code === 200) {',
        "  const body = pm.response.json();",
        "  pm.collectionVariables.set('accessToken', body.tokens.accessToken);",
        "  pm.collectionVariables.set('refreshToken', body.tokens.refreshToken);",
        '}',
      ],
    },
  });

  // --- POST /auth/refresh ---
  const refresh = findItemByPath(collection, ['auth', 'refresh']);
  refresh.request.body.raw = JSON.stringify({ refreshToken: '{{refreshToken}}' }, null, 2);
  refresh.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        'if (pm.response.code === 200) {',
        "  pm.collectionVariables.set('accessToken', pm.response.json().accessToken);",
        '}',
      ],
    },
  });

  // --- POST /auth/logout ---
  const logout = findItemByPath(collection, ['auth', 'logout']);
  logout.request.auth.bearer[0].value = '{{accessToken}}';

  return collection;
}

Converter.convert({ type: 'file', data: SPEC_PATH }, CONVERT_OPTIONS, (err, result) => {
  if (err) {
    console.error('✖ Falló la conversión OpenAPI → Postman:', err.message);
    process.exit(1);
  }

  if (!result.result) {
    console.error('✖ Falló la conversión OpenAPI → Postman:', result.reason);
    process.exit(1);
  }

  const collection = wireUpIdentityFlow(result.output[0].data);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(collection, null, 2) + '\n', 'utf8');
  console.log(`✔ Colección generada en ${path.relative(process.cwd(), OUTPUT_PATH)}`);
});
