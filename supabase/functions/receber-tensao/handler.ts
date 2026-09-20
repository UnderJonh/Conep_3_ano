export type Amostra = { tensao: number; instante_ms: number };
export type Leitura = { teste_id: string; player: 1 | 2 } & (
  { tensao: number; amostras?: never } | { amostras: Amostra[]; tensao?: never }
);
export type LoteLeituras = {
  teste_id: string;
  leituras: Array<{ player: 1 | 2; amostras: Amostra[] }>;
};
export type Entrada = Leitura | LoteLeituras;
export type Registro = { ok: true; teste_id: string; player: 1 | 2; tensao?: number; comandos?: number };
export type Registrar = (leitura: Leitura, tokenHash: string) => Promise<{
  data: Registro | null;
  error: { code: string; message: string } | null;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-device-token, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export function validarLeitura(value: unknown): value is Leitura {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const base = Object.keys(input).every((key) => ['teste_id', 'player', 'tensao', 'amostras'].includes(key)) &&
    typeof input.teste_id === 'string' && uuid.test(input.teste_id) &&
    (input.player === 1 || input.player === 2);
  if (!base) return false;
  const voltage = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 3.6;
  if ('tensao' in input) return !('amostras' in input) && voltage(input.tensao);
  return Array.isArray(input.amostras) && input.amostras.length >= 1 && input.amostras.length <= 50 &&
    input.amostras.every((sample: unknown, index: number, samples: unknown[]) => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return false;
      const item = sample as Record<string, unknown>;
      return Object.keys(item).every((key) => ['tensao', 'instante_ms'].includes(key)) && voltage(item.tensao) &&
        Number.isSafeInteger(item.instante_ms) && Number(item.instante_ms) > 0 &&
        (index === 0 || Number((samples[index - 1] as Amostra).instante_ms) < Number(item.instante_ms));
    });
}

export function validarEntrada(value: unknown): value is Entrada {
  if (validarLeitura(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).every((key) => ['teste_id', 'leituras'].includes(key)) ||
    typeof input.teste_id !== 'string' || !uuid.test(input.teste_id) ||
    !Array.isArray(input.leituras) || input.leituras.length < 1 || input.leituras.length > 2) return false;
  const players = new Set<number>();
  return input.leituras.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const reading = item as Record<string, unknown>;
    if (!Object.keys(reading).every((key) => ['player', 'amostras'].includes(key)) ||
      typeof reading.player !== 'number' || players.has(reading.player)) return false;
    players.add(reading.player);
    return validarLeitura({ teste_id: input.teste_id, ...reading });
  });
}

function databaseError(error: { code: string; message: string }) {
  const known: Record<string, number> = { PT400: 400, PT401: 401, PT403: 403, PT404: 404, PT409: 409 };
  const status = known[error.code] ?? 500;
  return json({ ok: false, error: status === 500 ? 'Não foi possível registrar a leitura.' : error.message }, status);
}

export function criarHandler(registrar: Registrar) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
    const token = request.headers.get('x-device-token') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: false, error: 'Token do dispositivo obrigatório.' }, 401);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ ok: false, error: 'Use Content-Type: application/json.' }, 415);
    }
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ ok: false, error: 'JSON obrigatório.' }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) {
          await reader.cancel();
          return json({ ok: false, error: 'Payload excede 8192 bytes.' }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return json({ ok: false, error: 'JSON inválido.' }, 400); }
      if (!validarEntrada(input)) return json({ ok: false, error: 'Informe UUID e uma leitura, ou um lote com os jogadores 1 e 2.' }, 400);

      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const readings: Leitura[] = 'leituras' in input
        ? input.leituras.map((item) => ({ teste_id: input.teste_id, ...item }))
        : [input];
      const registrations: Registro[] = [];
      for (const reading of readings) {
        const { data, error } = await registrar(reading, hash);
        if (error) return databaseError(error);
        if (!data) return json({ ok: false, error: 'Resposta vazia do servidor.' }, 500);
        registrations.push(data);
      }
      return json('leituras' in input
        ? { ok: true, teste_id: input.teste_id, jogadores: registrations }
        : registrations[0]);
    } catch {
      return json({ ok: false, error: 'Serviço temporariamente indisponível.' }, 503);
    }
  };
}
