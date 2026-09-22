import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { attachWebSocketGateway } from './websocket-gateway.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

if (!existsSync(join(root, 'index.html'))) {
  console.error('Build não encontrado. Execute npm run build antes de iniciar.');
  process.exit(1);
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  let file = resolve(root, relative);
  if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`) && file !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
  const extension = extname(file).toLowerCase();
  response.writeHead(200, {
    'Content-Type': types[extension] ?? 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
});

if (supabaseUrl && serviceKey) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  attachWebSocketGateway(server, supabase);
} else {
  console.warn('Gateway WebSocket desativado: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usá-lo.');
}
server.listen(port, '0.0.0.0', () => console.log(`Crossy Road disponível na porta ${port}`));
