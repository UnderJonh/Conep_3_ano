# Crossy Road · CONEP

Uma única placa ESP32 controla a galinha: **cada pisada forte e solta faz a galinha avançar uma casa**. Não há competição, segundo jogador, duração de corrida ou ranking na interface.

O jogo usa o motor 3D, os modelos, as texturas e a fonte de `Expo-Crossy-Road-master/`. O frontend React/Vite adapta o motor Expo para WebGL no navegador, mantendo carros, trens, rios, colisões, pontuação e reinício. A faixa central de árvores e as passagens estáticas do rio ficam livres para o controle apenas para frente.

## Executar

```powershell
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173/**. O jogo abre diretamente, inclusive sem Supabase. É possível testar tocando na tela ou pressionando **espaço / seta para cima**; segurar a tecla não repete passos. Ao colidir, clique em **Jogar novamente**.

Para usar o ESP, configure na raiz `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (modelo em `.env.example`). Use somente a chave pública. A conexão do jogo com a placa fica vinculada à sessão anônima deste navegador.

## Configurar uma placa

1. Clique na **engrenagem**, ao lado de **Créditos**. O jogo pausa enquanto a configuração está aberta.
2. Informe a rede **Wi-Fi 2.4 GHz**, a senha e o GPIO ADC1 do sensor (padrão **34**).
3. Ajuste a **força mínima da pisada** e clique em **Salvar força mínima**. O padrão é **1,50 V**; o ajuste vai de **0,60 a 3,30 V**.
4. Clique em **Gerar token da placa** e em **Baixar config.h**.
5. Coloque `config.h`, `esp32/sketch.ino` e `esp32/certificados.h` na mesma pasta e grave o firmware pela Arduino IDE.
6. Abra o Monitor Serial em **115200 baud**. HTTP 200 confirma os envios. A janela do jogo mostra a tensão e indica **Recebendo sinal do ESP32** quando há leituras recentes.
7. Feche a configuração e pise forte para começar. Cada pisada completa gera um avanço.

A senha do Wi-Fi e o token ficam em memória durante a página e no `config.h` baixado; não são gravados no armazenamento local pelo frontend. Fechar e reabrir a janela preserva os campos durante essa sessão. Após recarregar a página, use o arquivo salvo ou substitua o token para baixar outra configuração. Substituir o token revoga o anterior. O arquivo é ignorado pelo Git.

Depois de configurar, a conexão volta automaticamente ao recarregar o jogo no mesmo navegador. Limpar os dados do site perde a identidade anônima associada à placa: gere uma configuração nova nesse caso.

## Regra da pisada

- O sensor precisa estar solto (**≤ 0,25 V**) antes da pisada.
- A pressão deve atingir o limite configurado e voltar a **≤ 0,25 V**.
- O pulso forte precisa durar **20 a 1.500 ms**; manter o sensor pressionado não produz passos contínuos.
- Há um intervalo mínimo de **200 ms** entre liberações válidas.
- Uma pisada válida avança uma casa. Uma pisada fraca não move a galinha.
- Envios duplicados não repetem comandos. Abertura da configuração, retorno de uma aba oculta e reconexão descartam comandos anteriores.

A tensão é usada como aproximação da força, não como uma medida calibrada em newtons. Limite a entrada física do ESP32 a **3,3 V**, com GND comum.

## Conexão e arquivos

O ESP captura amostras a cada **20 ms** e envia lotes HTTPS a cada **200 ms**, com `X-Device-Token`, para a Edge Function existente `receber-tensao`. O payload conserva `teste_id`, `player: 1` e `amostras` com `tensao` / `instante_ms`. O servidor detecta a pisada e incrementa `infos_player_1.comandos`; o navegador recebe essa atualização pelo Supabase Realtime.

A migration `supabase/migrations/20260917140736_crossy_single_esp.sql` acrescenta o modo Crossy e a sensibilidade à estrutura existente, com autorização por proprietário. As conexões Crossy aceitam somente a placa 1 e não abrem corridas. Os registros históricos anteriores permanecem no banco.

| Arquivo | Responsabilidade |
| --- | --- |
| `frontend/src/components/CrossyApp.tsx` | Jogo em tela inteira, pontuação, reinício, engrenagem e créditos. |
| `frontend/src/components/CrossyEspSetup.tsx` | Wi-Fi, GPIO, sensibilidade, token e download de `config.h`. |
| `frontend/src/hooks/useCrossyEsp.ts` | Sessão, conexão da placa, Realtime e proteção contra repetição. |
| `frontend/src/crossy/` | Adaptação do motor original para navegador. |
| `frontend/src/lib/credits.ts` | **Edite aqui os créditos e os nomes da equipe.** |
| `frontend/src/crossy.css` | Estilos do jogo e das janelas. |
| `esp32/sketch.ino` | Firmware de uma placa. |

## Verificação

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

Os testes de navegador verificam o jogo 3D, teclado, créditos, celular, exportação de uma placa e envio real à Edge Function até o avanço via Realtime. O teste de integração precisa do Supabase configurado. `supabase/tests/crossy.sql` verifica pisadas fracas, fortes, duplicadas, repiques, pressão mantida e sensibilidade em uma transação com rollback.

O jogo requer **WebGL 2**. A validação de navegador usa Playwright, pois o Browser plugin não está disponível nesta sessão. A placa física e o circuito precisam de teste no hardware.

O jogo original é de **Evan Bacon**, sob licença MIT. A licença está em `Expo-Crossy-Road-master/LICENSE` e é incluída no frontend em `/crossy-license.txt`.