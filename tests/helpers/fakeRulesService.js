const http = require('node:http');

/**
 * Doble HTTP del Rules Service (MANI-Java) que habla el contrato real de
 * POST /api/v1/rules/categories/evaluate. No reimplementa las reglas: por
 * defecto aprueba y devuelve la entrada "normalizada"; cada prueba fija la
 * respuesta con respondWith() y puede inspeccionar las peticiones recibidas.
 */
function defaultResponder({ body }) {
  const ctx = body.context || {};
  return {
    status: 200,
    body: {
      allowed: true,
      ruleSetVersion: 'fake-rules-v1',
      violations: [],
      normalized: {
        name: ctx.name == null ? null : ctx.name.trim().replace(/\s+/g, ' '),
        flujoOperativo: ctx.flujoOperativo == null ? null : ctx.flujoOperativo.trim().toUpperCase(),
      },
    },
  };
}

async function startFakeRulesService() {
  const requests = [];
  let responder = defaultResponder;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : {} };
      requests.push(entry);
      const { status, body } = responder(entry);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    respondWith(fn) {
      responder = fn;
    },
    reset() {
      responder = defaultResponder;
      requests.length = 0;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeRulesService };
