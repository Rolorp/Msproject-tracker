import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.mjs';

function request(url) {
  return new Promise(resolve => {
    const result = {};
    server.emit('request', { url }, {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
        return this;
      },
      end(body) { resolve({ ...result, body }); }
    });
  });
}

test('sirve la entrada y los módulos desde dist', async () => {
  const entry = await request('/');
  assert.equal(entry.status, 200);
  assert.match(entry.body.toString(), /<title>MSproject tracker<\/title>/);
  assert.equal(entry.headers['Content-Type'], 'text/html; charset=utf-8');
  const module = await request('/ocr-parser.js');
  assert.equal(module.status, 200);
  assert.equal(module.headers['Content-Type'], 'text/javascript; charset=utf-8');
});

test('limita los archivos al directorio estático y responde a rutas inexistentes', async () => {
  assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
  assert.equal((await request('/no-existe')).status, 404);
});
