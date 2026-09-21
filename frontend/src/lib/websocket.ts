export function websocketUrl() {
  const configured = import.meta.env.VITE_WS_URL?.trim();
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function websocketFirmwareConfig() {
  const url = new URL(websocketUrl());
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Endereco WebSocket invalido.');
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'wss:' ? 443 : 80)),
    path: `${url.pathname || '/ws'}${url.search}`,
    secure: url.protocol === 'wss:',
  };
}
