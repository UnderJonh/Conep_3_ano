// Alguns serviços Railway antigos mantêm `npm run dev` como comando manual.
// Nesse ambiente, servimos o build na porta pública; localmente, iniciamos o Vite.
if (process.env.PORT) {
  const { existsSync } = await import('node:fs');
  if (!existsSync(new URL('./dist/index.html', import.meta.url))) {
    const { build } = await import('vite');
    await build();
  }
  await import('./server.mjs');
} else {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
  server.printUrls();
}
