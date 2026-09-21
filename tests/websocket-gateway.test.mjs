import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { attachWebSocketGateway } from '../websocket-gateway.mjs';

const TEST_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), 2000);
    socket.once('message', raw => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

test('autentica placa e navegador, transmite comando e ignora duplicata', async () => {
  const registrations = [];
  const supabase = {
    rpc: async (name, args) => {
      if (name === 'autenticar_dispositivo_ws') return { data: true, error: null };
      registrations.push(args);
      return { data: { ok: true, aceito: true }, error: null };
    },
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: TEST_ID }, error: null }) }),
        }),
      }),
    }),
  };
  const server = createServer();
  const gateway = attachWebSocketGateway(server, supabase, { logger: { error() {}, warn() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/ws`;

  const viewer = await openSocket(url);
  viewer.send(JSON.stringify({ type: 'auth', role: 'viewer', teste_id: TEST_ID, access_token: 'jwt' }));
  assert.equal((await nextMessage(viewer)).type, 'auth_ok');

  const device = await openSocket(url);
  device.send(JSON.stringify({ type: 'auth', role: 'device', teste_id: TEST_ID, token: TOKEN }));
  assert.equal((await nextMessage(device)).type, 'auth_ok');

  const viewerCommand = nextMessage(viewer);
  const deviceAck = nextMessage(device);
  device.send(JSON.stringify({ type: 'command', player: 1, session: '1234abcd', sequence: 1, voltage: 2.7 }));
  assert.deepEqual(await viewerCommand, {
    type: 'command', teste_id: TEST_ID, player: 1, session: '1234abcd', sequence: 1, voltage: 2.7,
  });
  assert.deepEqual(await deviceAck, { type: 'ack', sequence: 1, duplicate: false });

  const duplicateAck = nextMessage(device);
  device.send(JSON.stringify({ type: 'command', player: 1, session: '1234abcd', sequence: 1, voltage: 2.7 }));
  assert.deepEqual(await duplicateAck, { type: 'ack', sequence: 1, duplicate: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].p_player, 1);

  viewer.close();
  device.close();
  await new Promise(resolve => setTimeout(resolve, 10));
  gateway.close();
  await new Promise(resolve => server.close(resolve));
});
