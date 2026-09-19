# Crossy Road · CONEP

Uma única placa ESP32 controla a galinha: **cada pisada forte e solta faz a galinha avançar uma casa**. O ranking mostra os jogadores e seus melhores recordes, sem segundo jogador ou corrida com tempo.

O jogo usa o motor 3D, os modelos, as texturas e a fonte de `Expo-Crossy-Road-master/`. O frontend React/Vite adapta o motor Expo para WebGL no navegador, mantendo carros, trens, rios, colisões, pontuação e reinício. A faixa central fica livre de árvores e pedras, e todos os rios têm uma passagem fixa no centro para o controle apenas para frente. O terreno mantém 24 faixas à frente e recicla somente as que já ficaram para trás, sem interromper a geração em partidas longas.

## Executar

```powershell
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173/**. O jogo abre diretamente, inclusive sem Supabase. É possível testar tocando na tela ou pressionando **espaço / seta para cima**; segurar a tecla não repete passos. Ao colidir, clique em **Jogar novamente**.

Para usar o ESP, configure na raiz `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (modelo em `.env.example`). Use somente a chave pública. A conexão do jogo com a placa fica vinculada à sessão anônima deste navegador.

## Personagem e sons

Clique no **ícone de paleta**, ao lado da engrenagem, para abrir a personalização. Escolha um dos sete personagens originais, ajuste a cor e veja a prévia 3D. A aparência muda imediatamente, preservando a pontuação.

Cada personagem usa seus próprios efeitos de avanço e derrota. A galinha mantém seus sons originais; os demais têm efeitos sintetizados exclusivos. A janela de personalização inclui **Sons do jogo** e **Testar som**, que toca o efeito do personagem selecionado.

Uma música retrô original toca em loop, com controle independente em **Música de fundo** e botão **Ouvir música**. Os dois volumes vão de **0 a 100%**; em 0%, o respectivo canal fica desativado. O navegador libera o áudio após o primeiro toque ou tecla. O jogo e a música pausam ao abrir uma janela ou ocultar a aba. Aparência e volumes ficam salvos neste navegador. Para gerar novamente os arquivos de áudio, execute `python scripts/generate-audio.py`.

## Ranking e recordes

Clique no **troféu** para ver os 20 melhores recordes, em ordem decrescente de passos. O recorde atual aparece no canto superior direito. Quando a partida termina com uma pontuação acima do recorde, a janela **Novo recorde!** pede o nome do jogador (até 24 caracteres). Clique em **Salvar no ranking**; pontuações iguais ou menores não abrem a janela. **Agora não** permite continuar sem registrar o nome.

Com Supabase configurado, o ranking é compartilhado entre navegadores. O nome e a pontuação são públicos; a gravação usa uma sessão anônima e uma RPC que valida os campos e impede duplicação da mesma partida. Falhas no envio mantêm a janela aberta para tentar novamente. Sem Supabase, os recordes ficam no armazenamento local do navegador.

## Banco do zero

A migration única `supabase/migrations/20260917155448_crossy_game_from_scratch.sql` cria toda a estrutura necessária em um banco vazio. Ela substitui as migrations antigas de monitoramento e corridas. Não há dependência de tabelas de rodadas, arena ou competição de dois jogadores.

| Tabela | Uso |
| --- | --- |
| `public.testes` | Conexões de uma placa, proprietário, sensibilidade, telemetria e contador de passos. |
| `private.dispositivos` | Hash SHA-256 do token de cada placa. |
| `private.sinais` | Estado da detecção de pisadas e proteção contra reenvios. |
| `public.crossy_ranking` | Nome, pontuação e data de cada recorde. |

As tabelas usam RLS. O navegador pode ler sua conexão e o ranking público; alterações de configuração e registro de recordes passam por RPCs. Somente a Edge Function, com credenciais de servidor, pode registrar leituras do ESP32.

Para um projeto Supabase novo, habilite **Authentication → Settings → Allow anonymous sign-ins**, copie as credenciais públicas para `.env.local` e execute:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
npx supabase functions deploy receber-tensao
```

Para recriar o banco de desenvolvimento local (requer Docker; apaga os dados locais):

```powershell
npx supabase start
npx supabase db reset --local
npx supabase db query --local --file supabase/tests/crossy.sql
```

Esta migration é uma base para banco vazio. Para **refazer do zero o projeto existente**, abra `supabase/rebuild.sql`, copie **todo o arquivo** para uma consulta nova no SQL Editor e execute. O script remove os objetos antigos do jogo, recria a estrutura e alinha seu histórico de migrations dentro de uma transação. Isso apaga conexões, tokens e rankings: gere outro token e grave o novo `config.h` no ESP32 depois. Auth, Storage e objetos que não pertencem ao jogo são preservados.

`supabase/rebuild.sql` é gerado a partir da migration; depois de alterar a migration, atualize o arquivo completo com `powershell -File supabase/rebuild.ps1`.

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

A migration do banco novo já inclui a sensibilidade, autorização por proprietário, registro de amostras e publicação Realtime de `public.testes`. As conexões aceitam somente a placa 1.

| Arquivo | Responsabilidade |
| --- | --- |
| `frontend/src/components/CrossyApp.tsx` | Jogo, pontuação, janela de novo recorde, reinício e controles. |
| `frontend/src/components/PlayerRanking.tsx` | Ranking de jogadores. |
| `frontend/src/hooks/useCrossyRanking.ts` | Leitura e gravação do ranking compartilhado ou local. |
| `frontend/src/components/CrossyEspSetup.tsx` | Wi-Fi, GPIO, sensibilidade, token e download de `config.h`. |
| `frontend/src/hooks/useCrossyEsp.ts` | Sessão, conexão da placa, Realtime e proteção contra repetição. |
| `frontend/src/crossy/` | Adaptação do motor original para navegador. |
| `frontend/src/lib/credits.ts` | **Edite aqui os créditos e os nomes da equipe.** |
| `frontend/src/crossy.css` | Estilos do jogo e das janelas. |
| `esp32/sketch.ino` | Firmware comentado de uma placa. |
| `esp32/README.md` | Documentação detalhada do firmware, circuito, dados e diagnóstico. |

## Verificação

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

Os testes de navegador verificam o jogo 3D, teclado, créditos, personalização, sons de cada personagem, música em loop, ranking, janela de recorde, persistência e celular. Uma simulação de 2.000 faixas verifica terreno contínuo, passagens livres, reciclagem e reinício. O teste de integração da placa precisa do Supabase configurado. `supabase/tests/crossy.sql` verifica autorização, tokens, amostras, detecção de pisadas e ranking em uma transação com rollback.

O jogo requer **WebGL 2**. A validação de navegador usa Playwright, pois o Browser plugin não está disponível nesta sessão. A placa física e o circuito precisam de teste no hardware.

O jogo original é de **Evan Bacon**, sob licença MIT. A licença está em `Expo-Crossy-Road-master/LICENSE` e é incluída no frontend em `/crossy-license.txt`.
