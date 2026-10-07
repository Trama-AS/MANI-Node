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

// --- Esquemas JSON (espejo de components.schemas en docs/openapi/core.yaml) ---
// Postman/ajv no resuelve $ref contra un archivo externo, así que se inlinean aquí.
const PROFILE_SUMMARY_SCHEMA = {
  type: 'object',
  required: ['id', 'tenantId', 'role', 'fullName', 'status'],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    role: { type: 'string', enum: ['CLIENT', 'ALLY', 'ADMIN'] },
    fullName: { type: 'string' },
    status: { type: 'string', enum: ['VERIFIED', 'PENDING', 'REJECTED'] },
  },
};

const AUTH_TOKENS_SCHEMA = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'expiresIn'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    expiresIn: { type: 'integer' },
  },
};

const AUTH_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['profile', 'tokens'],
  properties: { profile: PROFILE_SUMMARY_SCHEMA, tokens: AUTH_TOKENS_SCHEMA },
};

const REFRESH_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['accessToken', 'expiresIn'],
  properties: { accessToken: { type: 'string' }, expiresIn: { type: 'integer' } },
};

// Decodifica el payload de un JWT en el sandbox de Postman (solo atob/JSON, sin libs externas).
const DECODE_JWT_HELPER = [
  'function decodeJwtPayload(token) {',
  '  try {',
  "    const payload = token.split('.')[1];",
  "    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');",
  "    const padded = base64 + '==='.slice((base64.length + 3) % 4);",
  '    return JSON.parse(atob(padded));',
  '  } catch (e) {',
  '    return null;',
  '  }',
  '}',
];

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

function testScript(exec) {
  return { listen: 'test', script: { type: 'text/javascript', exec } };
}

/**
 * La conversión automática desde OpenAPI solo produce paths/métodos/esquemas con
 * valores de ejemplo estáticos. Para que la colección "recorra en secuencia" el
 * flujo de identidad (registrar → login → refresh → logout) hace falta encadenar
 * variables entre requests, y para que cada paso se valide a sí mismo se le agregan
 * asserts de: (1) código de estado, (2) esquema de respuesta, (3) propagación del
 * claim `tenant_id` (del header `X-Tenant-Id` al JWT, y del JWT al siguiente JWT).
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
          '// Email único por corrida para no chocar con EMAIL_ALREADY_REGISTERED',
          "pm.collectionVariables.set('allyEmail', `aliado.${Date.now()}@mani.test`);",
        ],
      },
    },
    testScript([
      ...DECODE_JWT_HELPER,
      '',
      "pm.test('responde 201 Created', function () {",
      '  pm.response.to.have.status(201);',
      '});',
      '',
      "pm.test('el body cumple el esquema RegisterAllyResponse', function () {",
      `  pm.response.to.have.jsonSchema(${JSON.stringify(AUTH_RESPONSE_SCHEMA)});`,
      '});',
      '',
      'if (pm.response.code === 201) {',
      '  const body = pm.response.json();',
      '',
      "  pm.test('el aliado queda en rol ALLY y estado PENDING', function () {",
      "    pm.expect(body.profile.role).to.eql('ALLY');",
      "    pm.expect(body.profile.status).to.eql('PENDING');",
      '  });',
      '',
      "  pm.test('propagación del claim de tenant: profile.tenantId === X-Tenant-Id enviado', function () {",
      "    pm.expect(body.profile.tenantId).to.eql(pm.collectionVariables.get('tenantId'));",
      '  });',
      '',
      "  pm.test('propagación del claim de tenant: tenant_id del accessToken === X-Tenant-Id enviado', function () {",
      '    const claims = decodeJwtPayload(body.tokens.accessToken);',
      "    pm.expect(claims, 'accessToken debe ser un JWT decodificable').to.not.equal(null);",
      "    pm.expect(claims.tenant_id).to.eql(pm.collectionVariables.get('tenantId'));",
      '  });',
      '',
      "  pm.collectionVariables.set('accessToken', body.tokens.accessToken);",
      "  pm.collectionVariables.set('refreshToken', body.tokens.refreshToken);",
      '}',
    ])
  );

  // --- POST /auth/login ---
  const login = findItemByPath(collection, ['auth', 'login']);
  setHeaderValue(login.request.header, 'X-Tenant-Id', '{{tenantId}}');
  login.request.body.raw = JSON.stringify({ email: '{{allyEmail}}', password: '{{allyPassword}}' }, null, 2);
  login.event.push(
    testScript([
      ...DECODE_JWT_HELPER,
      '',
      "pm.test('responde 200 OK', function () {",
      '  pm.response.to.have.status(200);',
      '});',
      '',
      "pm.test('el body cumple el esquema LoginResponse', function () {",
      `  pm.response.to.have.jsonSchema(${JSON.stringify(AUTH_RESPONSE_SCHEMA)});`,
      '});',
      '',
      'if (pm.response.code === 200) {',
      '  const body = pm.response.json();',
      '',
      "  pm.test('propagación del claim de tenant: profile.tenantId === X-Tenant-Id enviado', function () {",
      "    pm.expect(body.profile.tenantId).to.eql(pm.collectionVariables.get('tenantId'));",
      '  });',
      '',
      "  pm.test('propagación del claim de tenant: tenant_id del accessToken === X-Tenant-Id enviado', function () {",
      '    const claims = decodeJwtPayload(body.tokens.accessToken);',
      "    pm.expect(claims, 'accessToken debe ser un JWT decodificable').to.not.equal(null);",
      "    pm.expect(claims.tenant_id).to.eql(pm.collectionVariables.get('tenantId'));",
      '  });',
      '',
      "  pm.collectionVariables.set('accessToken', body.tokens.accessToken);",
      "  pm.collectionVariables.set('refreshToken', body.tokens.refreshToken);",
      '}',
    ])
  );

  // --- POST /auth/refresh ---
  const refresh = findItemByPath(collection, ['auth', 'refresh']);
  refresh.request.body.raw = JSON.stringify({ refreshToken: '{{refreshToken}}' }, null, 2);
  refresh.event.push(
    testScript([
      ...DECODE_JWT_HELPER,
      '',
      "pm.test('responde 200 OK', function () {",
      '  pm.response.to.have.status(200);',
      '});',
      '',
      "pm.test('el body cumple el esquema RefreshResponse', function () {",
      `  pm.response.to.have.jsonSchema(${JSON.stringify(REFRESH_RESPONSE_SCHEMA)});`,
      '});',
      '',
      'if (pm.response.code === 200) {',
      '  const body = pm.response.json();',
      '',
      "  pm.test('propagación del claim de tenant: el refresh preserva tenant_id del token original', function () {",
      '    const claims = decodeJwtPayload(body.accessToken);',
      "    pm.expect(claims, 'accessToken debe ser un JWT decodificable').to.not.equal(null);",
      "    pm.expect(claims.tenant_id).to.eql(pm.collectionVariables.get('tenantId'));",
      '  });',
      '',
      "  pm.collectionVariables.set('accessToken', body.accessToken);",
      '}',
    ])
  );

  // --- POST /auth/logout ---
  const logout = findItemByPath(collection, ['auth', 'logout']);
  logout.request.auth.bearer[0].value = '{{accessToken}}';
  logout.event.push(
    testScript([
      ...DECODE_JWT_HELPER,
      '',
      "pm.test('responde 204 No Content', function () {",
      '  pm.response.to.have.status(204);',
      '});',
      '',
      "pm.test('el body de 204 viene vacío', function () {",
      '  pm.expect(pm.response.text()).to.have.lengthOf(0);',
      '});',
      '',
      "pm.test('propagación del claim de tenant: el accessToken usado pertenecía al tenant de la sesión', function () {",
      "  const claims = decodeJwtPayload(pm.collectionVariables.get('accessToken'));",
      "  pm.expect(claims, 'accessToken debe ser un JWT decodificable').to.not.equal(null);",
      "  pm.expect(claims.tenant_id).to.eql(pm.collectionVariables.get('tenantId'));",
      '});',
    ])
  );

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
