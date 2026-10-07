const path = require('node:path');
const SwaggerParser = require('@apidevtools/swagger-parser');

const specPath = path.join(__dirname, '..', 'docs', 'openapi', 'core.yaml');

SwaggerParser.validate(specPath)
  .then((api) => {
    const paths = Object.keys(api.paths).join(', ');
    console.log(`✔ OpenAPI válido: ${api.info.title} (v${api.info.version})`);
    console.log(`  Paths: ${paths}`);
  })
  .catch((err) => {
    console.error(`✖ OpenAPI inválido: ${err.message}`);
    process.exit(1);
  });
