# Crossy Road · CONEP

Uma única placa ESP32 pode controlar um ou dois personagens: **cada jogador usa seu próprio sensor e cada pisada forte e solta faz somente o seu personagem avançar uma casa**. O modo tradicional de um jogador e o ranking continuam disponíveis.

O jogo usa o motor 3D, os modelos, as texturas e a fonte de `Expo-Crossy-Road-master/`. O frontend React/Vite adapta o motor Expo para WebGL no navegador, mantendo carros, trens, rios, colisões, pontuação e reinício. A faixa central fica livre de árvores e pedras, e todos os rios têm uma passagem fixa no centro para o controle apenas para frente. O terreno mantém 24 faixas à frente e recicla somente as que já ficaram para trás, sem interromper a geração em partidas longas.

## Executar

```powershell
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173/**. O jogo abre diretamente, inclusive sem Supabase. No modo de um jogador, teste tocando na tela ou pressionando **espaço / seta para cima**; segurar a tecla não repete passos. Ao colidir, clique em **Jogar novamente**.

Para usar o ESP, configure na raiz `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (modelo em `.env.example`). Use somente a chave pública no frontend. O servidor publicado também exige `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; a chave secreta nunca pode usar o prefixo `VITE_`.

## Multiplayer local

Clique no ícone de duas pessoas no canto inferior da tela. Antes da partida, cada jogador escolhe seu personagem e sua cor. A tela é dividida em duas câmeras do mesmo mundo 3D: os veículos, rios e faixas são compartilhados, e um jogador consegue ver o outro quando estão próximos.

- Jogador 1: **Espaço** ou sensor no pino configurado para o jogador 1.
- Jogador 2: **Enter** ou sensor no pino configurado para o jogador 2.

No modo de um jogador, a música muda para uma progressão de expectativa ao alcançar 50% do recorde atual. Ao ultrapassar o recorde, entra a progressão vitoriosa e o personagem recebe uma coroa. Esses efeitos não são usados no multiplayer local.
- Cada metade tem placar e estado de partida independentes.
- Em telas estreitas, as câmeras ficam uma acima da outra.

## Personagem e sons

Clique no **ícone de paleta**, ao lado da engrenagem, para abrir a personalização. Escolha um dos sete personagens originais, ajuste a cor e veja a prévia 3D. A aparência muda imediatamente, preservando a pontuação.

Cada personagem usa seus próprios efeitos de avanço e derrota. A galinha mantém seus sons originais; os demais têm efeitos sintetizados exclusivos. A janela de personalização inclui **Sons do jogo** e **Testar som**, que toca o efeito do personagem selecionado.

Uma música retrô original toca em loop, com controle independente em **Música de fundo** e botão **Ouvir música**. Os dois volumes vão de **0 a 100%**; em 0%, o respectivo canal fica desativado. O navegador libera o áudio após o primeiro toque ou tecla. O jogo e a música pausam ao abrir uma janela ou ocultar a aba. Aparência e volumes ficam salvos neste navegador. Para gerar novamente os arquivos de áudio, execute `python scripts/generate-audio.py`.

## Ranking e recordes

Clique no **troféu** para ver os 20 melhores recordes, em ordem decrescente de passos. O recorde atual aparece no canto superior direito. Quando a partida termina com uma pontuação acima do recorde, a janela **Novo recorde!** pede o nome do jogador (até 24 caracteres). Clique em **Salvar no ranking**; pontuações iguais ou menores não abrem a janela. **Agora não** permite continuar sem registrar o nome.

Com Supabase configurado, o ranking é compartilhado entre navegadores. O nome e a pontuação são públicos; a gravação usa uma sessão anônima e uma RPC que valida os campos e impede duplicação da mesma partida. Falhas no envio mantêm a janela aberta para tentar novamente. Sem Supabase, os recordes ficam no armazenamento local do navegador.

## Banco do zero

A migration base `supabase/migrations/20260917155448_crossy_game_from_scratch.sql` cria toda a estrutura necessária em um banco vazio. A migration `20260920154931_local_multiplayer.sql` atualiza instalações existentes com o segundo canal de sensor. Não há dependência de tabelas de rodadas, arena ou corrida com tempo.

| Tabela | Uso |
| --- | --- |
| `public.testes` | Conexões de uma placa, proprietário, sensibilidade e telemetria/contador separados para os dois jogadores. |
| `private.dispositivos` | Hash SHA-256 do token de cada placa. |
| `private.sinais` | Estado da detecção de pisadas e proteção contra reenvios. |
| `public.crossy_ranking` | Nome, pontuação e data de cada recorde. |

As tabelas usam RLS. O navegador pode ler sua conexão e o ranking público; alterações de configuração e registro de recordes passam por RPCs. Somente o gateway WebSocket e a Edge Function legada, ambos com credenciais de servidor, podem registrar comandos ou leituras do ESP32.

Para um projeto Supabase novo, habilite **Authentication → Settings → Allow anonymous sign-ins**, copie as credenciais públicas para `.env.local` e execute:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
npx supabase functions deploy receber-tensao
```

No Railway, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. O mesmo serviço HTTP atende o site e o endpoint WebSocket `/ws`.

Para recriar o banco de desenvolvimento local (requer Docker; apaga os dados locais):

```powershell
npx supabase start
npx supabase db reset --local
npx supabase db query --local --file supabase/tests/crossy.sql
```

Esta migration é uma base para banco vazio. Para **refazer do zero o projeto existente**, abra `supabase/rebuild.sql`, copie **todo o arquivo** para uma consulta nova no SQL Editor e execute. O script remove os objetos antigos do jogo, recria a estrutura e alinha seu histórico de migrations dentro de uma transação. Isso apaga conexões, tokens e rankings: gere outro token e grave o novo `config.h` no ESP32 depois. Auth, Storage e objetos que não pertencem ao jogo são preservados.

`supabase/rebuild.sql` é gerado a partir da migration; depois de alterar a migration, atualize o arquivo completo com `powershell -File supabase/rebuild.ps1`.

## Montar o controle

A placa é só um controle de dois botões ligado por cabo USB. Não usa Wi-Fi, nuvem nem certificado.

1. Ligue cada botão assim: um lado no **3V3**, o outro no **GPIO 34** (jogador 1) ou **GPIO 35** (jogador 2), e um resistor de **10 kΩ** desse mesmo lado até o **GND**.
2. Ligue o LED de cada botão no **GPIO 32** (jogador 1) ou **GPIO 33** (jogador 2), com um resistor de **220 Ω** em série até o **GND**. O LED fica aceso esperando e apaga enquanto o botão está apertado.
3. Abra `esp32/sketch/sketch.ino` na Arduino IDE, selecione a placa e a porta USB e grave o firmware. Nenhuma biblioteca externa é necessária.
4. Abra o Monitor Serial em **115200 baud**. A placa se apresenta com `ID CROSSY-CONTROLE v1` e mostra `P1` ou `P2` a cada toque.
5. Feche o Monitor Serial, abra o jogo e clique na **engrenagem** para ver a aba do controle.

Os pinos 34 e 35 são só de entrada e não têm resistor interno: sem o pull-down de 10 kΩ o pino flutua e o personagem anda sozinho. No jogo, o botão do jogador 1 simula a tecla **ESPAÇO** e o do jogador 2 simula **ENTER** — as mesmas do multiplayer local. Detalhes de ligação, protocolo e diagnóstico ficam em [`esp32/README.md`](esp32/README.md).


## Regra da pisada

- O sensor precisa estar solto (**≤ 0,25 V**) antes da pisada.
- A pressão deve atingir o limite configurado e voltar a **≤ 0,25 V**.
- O pulso forte precisa durar **20 a 1.500 ms**; manter o sensor pressionado não produz passos contínuos.
- Há um intervalo mínimo de **200 ms** entre liberações válidas.
- Uma pisada válida avança uma casa. Uma pisada fraca não move a galinha.
- Envios duplicados não repetem comandos. Abertura da configuração, retorno de uma aba oculta e reconexão descartam comandos anteriores.

A tensão é usada como aproximação da força, não como uma medida calibrada em newtons. Limite a entrada física do ESP32 a **3,3 V**, com GND comum.

## Conexão e arquivos

O ESP lê os dois sensores a cada **50 ms** e detecta a pisada localmente. Ao soltar o sensor, envia imediatamente um pacote pequeno pela conexão WebSocket persistente. O gateway autentica a placa, encaminha o comando ao navegador sem esperar o banco e persiste o contador no Supabase em segundo plano. Sessão e sequência impedem repetição de pacotes; telemetria leve a cada 500 ms atualiza os indicadores de tensão.

A migration já inclui a sensibilidade, autorização por proprietário, registro de amostras e publicação Realtime de `public.testes`. Há uma placa física por conexão, com um token compartilhado pelos dois pinos.

| Arquivo | Responsabilidade |
| --- | --- |
| `frontend/src/components/CrossyApp.tsx` | Jogo, pontuação, janela de novo recorde, reinício e controles. |
| `frontend/src/components/PlayerRanking.tsx` | Ranking de jogadores. |
| `frontend/src/hooks/useCrossyRanking.ts` | Leitura e gravação do ranking compartilhado ou local. |
| `frontend/src/components/EspControllerGuide.tsx` | Aba que explica o projeto e como o controle funciona. |
| `frontend/src/hooks/useCrossyEsp.ts` | Sessão, WebSocket de baixa latência, fallback Realtime e proteção contra repetição. |
| `websocket-gateway.mjs` | Autenticação, salas WebSocket, entrega imediata e persistência assíncrona. |
| `frontend/src/crossy/` | Adaptação do motor original para navegador. |
| `frontend/src/lib/credits.ts` | **Edite aqui os créditos e os nomes da equipe.** |
| `frontend/src/crossy.css` | Estilos do jogo e das janelas. |
| `esp32/sketch/sketch.ino` | Firmware do controle: dois botões e a porta serial. |
| `esp32/README.md` | Ligação dos botões, protocolo da serial e diagnóstico. |

## Verificação

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

Os testes de navegador verificam o jogo 3D, teclado, multiplayer local, placares independentes, créditos, personalização, sons, ranking, persistência e celular. Uma simulação de 2.000 faixas verifica terreno contínuo, passagens livres, reciclagem e reinício. O teste de integração da placa precisa do Supabase configurado. `supabase/tests/crossy.sql` verifica autorização, tokens, amostras dos dois jogadores, detecção de pisadas e ranking em uma transação com rollback.

O jogo requer **WebGL 2**. A validação de navegador usa Playwright, pois o Browser plugin não está disponível nesta sessão. A placa física e o circuito precisam de teste no hardware.

O jogo original é de **Evan Bacon**, sob licença MIT. A licença está em `Expo-Crossy-Road-master/LICENSE` e é incluída no frontend em `/crossy-license.txt`.
