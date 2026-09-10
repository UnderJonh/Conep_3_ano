export type Leitura = { teste_id: string; player: 1 | 2; tensao: number };
export type Registro = Leitura & { ok: true; rodada: number };
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
  return Object.keys(input).every((key) => ['teste_id', 'player', 'tensao'].includes(key)) &&
    typeof input.teste_id === 'string' && uuid.test(input.teste_id) &&
    (input.player === 1 || input.player === 2) &&
    typeof input.tensao === 'number' && Number.isFinite(input.tensao) && input.tensao >= 0;
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
      // Limita também corpos sem Content-Length, antes de carregar tudo na memória.
      const reader = request.body?.getReader();
      if (!reader) return json({ ok: false, error: 'JSON obrigatório.' }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1024) {
          await reader.cancel();
          return json({ ok: false, error: 'Payload excede 1024 bytes.' }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let leitura: unknown;
      try { leitura = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return json({ ok: false, error: 'JSON inválido.' }, 400); }
      if (!validarLeitura(leitura)) return json({ ok: false, error: 'Informe teste_id UUID, player 1 ou 2 e tensão numérica não negativa.' }, 400);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const { data, error } = await registrar(leitura, hash);
      if (error) {
        const known: Record<string, number> = { PT400: 400, PT401: 401, PT403: 403, PT404: 404, PT409: 409 };
        const status = known[error.code] ?? 500;
        return json({ ok: false, error: status === 500 ? 'Não foi possível registrar a leitura.' : error.message }, status);
      }
      if (!data) return json({ ok: false, error: 'Resposta vazia do servidor.' }, 500);
      return json(data);
    } catch {
      return json({ ok: false, error: 'Serviço temporariamente indisponível.' }, 503);
    }
  };
}
