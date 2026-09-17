import { criarHandler, validarLeitura } from './handler.ts';
import type { Registrar } from './handler.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
}
const leitura = { teste_id: '11111111-1111-4111-8111-111111111111', player: 1 as const, tensao: 2.81 };
const request = (body: unknown, token = 'a'.repeat(64)) => new Request('http://localhost', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': token }, body: JSON.stringify(body),
});
const success: Registrar = async (value) => ({ data: { ...value, ok: true, comandos: 3 }, error: null });

Deno.test('valida UUID, player estrito, tensão finita e propriedades permitidas', () => {
  for (const value of [null, [], {}, { ...leitura, teste_id: 'abc' }, { ...leitura, player: '1' },
    { ...leitura, player: 3 }, { ...leitura, tensao: -0.01 }, { ...leitura, tensao: '2.8' },
    { ...leitura, tensao: Infinity }, { ...leitura, tensao: NaN }, { ...leitura, pontos: 100 }]) {
    equal(validarLeitura(value), false);
  }
  equal(validarLeitura({ ...leitura, tensao: 0 }), true);
  equal(validarLeitura({ ...leitura, player: 2, tensao: 3.6 }), false);
  equal(validarLeitura({ ...leitura, tensao: 3.6 }), true);
});
Deno.test('retorna leitura e envia só hash SHA-256 ao banco', async () => {
  const handler = criarHandler(async (value, hash) => {
    equal(value, leitura);
    equal(hash, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
    return success(value, hash);
  });
  const response = await handler(request(leitura));
  equal(response.status, 200);
  equal(await response.json(), { ...leitura, ok: true, comandos: 3 });
});
Deno.test('nega token ausente e nunca consulta banco em payload inválido', async () => {
  const handler = criarHandler(() => { throw new Error('Não deveria chamar o banco'); });
  equal((await handler(request(leitura, ''))).status, 401);
  equal((await handler(request({ ...leitura, player: 9 }))).status, 400);
  equal((await handler(request({ ...leitura, teste_id: 'a'.repeat(5000) }))).status, 413);
  equal((await handler(new Request('http://localhost', { method: 'POST', headers: { 'x-device-token': 'a'.repeat(64), 'content-type': 'application/json' }, body: '{' }))).status, 400);
});

Deno.test('aceita lotes ordenados e rejeita replay dentro do lote, tensão fora da faixa e formatos misturados', () => {
  const base = { teste_id: leitura.teste_id, player: 1 };
  const samples = [{ tensao: 0, instante_ms: 1700000000000 }, { tensao: 2.8, instante_ms: 1700000000020 }];
  equal(validarLeitura({ ...base, amostras: samples }), true);
  for (const amostras of [[], samples.toReversed(), [samples[0], samples[0]], [{ ...samples[0], tensao: 9 }],
    [{ ...samples[0], instante_ms: 1.2 }], Array.from({ length: 51 }, (_, i) => ({ tensao: 1, instante_ms: 1700000000000 + i }))]) {
    equal(validarLeitura({ ...base, amostras }), false);
  }
  equal(validarLeitura({ ...leitura, amostras: samples }), false);
  equal(validarLeitura({ ...leitura, tensao: 3.61 }), false);
});
Deno.test('propaga erros esperados e oculta detalhes internos', async () => {
  for (const code of ['PT400', 'PT401', 'PT403', 'PT404', 'PT409', 'XX000']) {
    const handler = criarHandler(async () => ({ data: null, error: { code, message: 'erro do banco' } }));
    const response = await handler(request(leitura));
    equal(response.status, code === 'XX000' ? 500 : Number(code.slice(2)));
    if (code === 'XX000') equal((await response.json()).error, 'Não foi possível registrar a leitura.');
  }
});
Deno.test('trata CORS, método, tipo de conteúdo e indisponibilidade', async () => {
  const handler = criarHandler(success);
  equal((await handler(new Request('http://localhost', { method: 'OPTIONS' }))).status, 204);
  equal((await handler(new Request('http://localhost'))).status, 405);
  equal((await handler(new Request('http://localhost', { method: 'POST', headers: { 'x-device-token': 'a'.repeat(64) }, body: 'texto' }))).status, 415);
  const failed = criarHandler(() => { throw new Error('offline'); });
  equal((await failed(request(leitura))).status, 503);
});
