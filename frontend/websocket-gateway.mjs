import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN = /^[a-f0-9]{64}$/;
const SESSION = /^[a-f0-9]{8}$/;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function close(socket, code, reason) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(code, reason);
}

export function attachWebSocketGateway(server, supabase, { logger = console } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const rooms = new Map();
  const recentCommands = new Map();

  function room(testId) {
    let viewers = rooms.get(testId);
    if (!viewers) { viewers = new Set(); rooms.set(testId, viewers); }
    return viewers;
  }

  function broadcast(testId, message) {
    for (const viewer of rooms.get(testId) ?? []) send(viewer, message);
  }

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch { socket.destroy(); return; }
    if (pathname !== '/ws') { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });

  sockets.on('connection', socket => {
    const state = {
      authenticated: false, role: null, testId: null, tokenHash: null,
      chain: Promise.resolve(), persistence: Promise.resolve(),
    };
    const authTimeout = setTimeout(() => close(socket, 4001, 'Autenticacao expirada'), 5000);

    async function authenticate(message) {
      if (state.authenticated || !UUID.test(message?.teste_id ?? '')) {
        close(socket, 4002, 'Autenticacao invalida');
        return;
      }

      if (message.role === 'device' && DEVICE_TOKEN.test(message.token ?? '')) {
        const tokenHash = createHash('sha256').update(message.token).digest('hex');
        const result = await supabase.rpc('autenticar_dispositivo_ws', {
          p_teste_id: message.teste_id,
          p_token_hash: tokenHash,
        });
        if (result.error || result.data !== true) {
          close(socket, 4003, 'Dispositivo nao autorizado');
          return;
        }
        Object.assign(state, { authenticated: true, role: 'device', testId: message.teste_id, tokenHash });
      } else if (message.role === 'viewer' && typeof message.access_token === 'string') {
        const auth = await supabase.auth.getUser(message.access_token);
        if (auth.error || !auth.data.user) {
          close(socket, 4003, 'Navegador nao autorizado');
          return;
        }
        const board = await supabase.from('testes').select('id').eq('id', message.teste_id)
          .eq('owner_id', auth.data.user.id).maybeSingle();
        if (board.error || !board.data) {
          close(socket, 4003, 'Conexao sem permissao');
          return;
        }
        Object.assign(state, { authenticated: true, role: 'viewer', testId: message.teste_id });
        room(state.testId).add(socket);
      } else {
        close(socket, 4002, 'Autenticacao invalida');
        return;
      }

      clearTimeout(authTimeout);
      send(socket, { type: 'auth_ok', role: state.role, teste_id: state.testId });
    }

    function persistCommand(message) {
      state.persistence = state.persistence.then(async () => {
        const result = await supabase.rpc('registrar_comando_ws', {
          p_teste_id: state.testId,
          p_player: message.player,
          p_sessao: message.session,
          p_sequencia: message.sequence,
          p_tensao: message.voltage,
          p_token_hash: state.tokenHash,
        });
        if (result.error) {
          logger.error('[WS] Falha ao persistir comando:', result.error.message);
          send(socket, { type: 'persist_error', sequence: message.sequence });
        }
      }).catch(error => logger.error('[WS] Falha ao persistir comando:', error));
    }

    async function handle(raw) {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { close(socket, 4002, 'JSON invalido'); return; }

      if (!state.authenticated) { await authenticate(message); return; }
      if (state.role !== 'device') return;

      if (message.type === 'telemetry') {
        if (!Array.isArray(message.voltages) || message.voltages.length !== 2 ||
          message.voltages.some(value => !Number.isFinite(value) || value < 0 || value > 3.6)) return;
        broadcast(state.testId, {
          type: 'telemetry', teste_id: state.testId, voltages: message.voltages, received_at: Date.now(),
        });
        return;
      }

      if (message.type !== 'command' || ![1, 2].includes(message.player) ||
        !SESSION.test(message.session ?? '') || !Number.isSafeInteger(message.sequence) ||
        message.sequence < 1 || message.sequence > 2147483647 ||
        !Number.isFinite(message.voltage) || message.voltage < 0 || message.voltage > 3.6) return;

      const key = `${state.testId}:${message.player}`;
      const previous = recentCommands.get(key);
      if (previous?.session === message.session && previous.sequence >= message.sequence) {
        send(socket, { type: 'ack', sequence: message.sequence, duplicate: true });
        return;
      }
      recentCommands.set(key, { session: message.session, sequence: message.sequence });

      broadcast(state.testId, {
        type: 'command', teste_id: state.testId, player: message.player,
        session: message.session, sequence: message.sequence, voltage: message.voltage,
      });
      send(socket, { type: 'ack', sequence: message.sequence, duplicate: false });
      persistCommand(message);
    }

    socket.on('message', raw => {
      state.chain = state.chain.then(() => handle(raw)).catch(error => {
        logger.error('[WS] Erro ao processar pacote:', error);
        close(socket, 1011, 'Erro interno');
      });
    });
    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (state.role === 'viewer' && state.testId) {
        const viewers = rooms.get(state.testId);
        viewers?.delete(socket);
        if (viewers?.size === 0) rooms.delete(state.testId);
      }
    });
    socket.on('error', error => logger.warn('[WS] Conexao encerrada:', error.message));
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 15000);
  sockets.on('connection', socket => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
  });
  sockets.on('close', () => clearInterval(heartbeat));
  return sockets;
}


