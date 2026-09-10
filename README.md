# CONEP · Monitoramento de tensão

Projeto completo com **ESP32 → HTTP POST → Supabase Edge Function → PostgreSQL → Realtime → React**. O ESP32 apenas lê o ADC e envia uma leitura. Rodadas, autorização e histórico são responsabilidade do servidor.

## Começar no projeto informado

A migration `20260910151138_monitoramento_tensao.sql` já foi aplicada e registrada no projeto **Conep 2026**, e a função **receber-tensao** já foi publicada. Realtime está habilitado para `public.testes`. A tabela anterior `responsible_profiles` e suas funções foram preservadas.

O arquivo local `.env.local`, ignorado pelo Git, já contém a URL e a chave pública fornecidas. Nenhuma chave administrativa foi gravada no código ou nesse arquivo.

```powershell
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. Entre com uma conta existente desse projeto Supabase. Se ainda não tiver uma, o responsável deve criá-la em **Authentication → Users → Add user → Create new user**, com e-mail e senha. Use criação direta, sem envio de convite, se não houver SMTP configurado. Esta aplicação não oferece cadastro público.

1. Em **Meus testes**, informe um nome e clique em **Criar teste**.
2. Abra **Configurar dispositivos**, copie o UUID e gere um token para cada player.
3. Copie cada token imediatamente: a aplicação não armazena o valor original para recuperação posterior.
4. Clique em **Iniciar teste**.
5. Envie leituras com curl ou configure os ESP32 conforme as seções abaixo.

Não reaplique manualmente a migration em um banco já configurado. As contas e os registros temporários usados na validação não fazem parte da aplicação.

## Arquivos

```text
frontend/
  src/
    App.tsx                   sessão e navegação
    components/               login, lista, monitor, players, histórico e dispositivos
    hooks/useTeste.ts          estado inicial, Realtime e recuperação da conexão
    lib/                      cliente Supabase, tipos e formatação
    styles.css                layout responsivo
  public/                     favicon e fallback de rotas para hospedagens compatíveis
  index.html, vite.config.ts, tsconfig.json, package.json
supabase/
  migrations/20260910151138_monitoramento_tensao.sql
  functions/receber-tensao/    entrada Deno, handler e testes
  tests/monitoramento.sql     autorização e integridade em transação revertida
  config.toml
esp32/
  sketch.ino                  firmware Arduino
  certificados.h             CAs públicas para validação HTTPS
  diagram.json               circuito Wokwi
tests/monitoramento.spec.ts   teste com navegador e Supabase reais
playwright.config.ts
.env.example, .env.test.example, .gitignore
package.json, package-lock.json
```

O diretório original estava vazio. Foram usados React + Vite + TypeScript, CSS simples e o cliente oficial Supabase. Não há backend simulado, polling ou dados de demonstração embutidos na interface.

## Arquitetura e banco

```mermaid
flowchart LR
  E1[ESP32 · Player 1] -->|HTTPS POST| F[receber-tensao]
  E2[ESP32 · Player 2] -->|HTTPS POST| F
  F -->|RPC registrar_tensao| T[(testes · estado atual)]
  T -->|postgres_changes UPDATE| R[Supabase Realtime]
  R -->|WebSocket| B[Navegador React]
  B -->|RPC finalizar_rodada| A[Transação PostgreSQL]
  A --> T
  A --> H[(rodadas · snapshots)]
```

| Estrutura | Finalidade |
| --- | --- |
| `public.testes` | Campos solicitados, mais `owner_id` para acesso e `revisao` para ordenar atualizações. |
| `public.rodadas` | Snapshot imutável por `(teste_id, numero)`. |
| `public.teste_participantes` | Usuários adicionais com permissão de visualização. |
| `private.dispositivos` | Um hash SHA-256 de token por teste/player; sem leitura pelo navegador. |

`infos_player_1` e `infos_player_2` começam como `{}`. O painel mostra `--` quando tensão, pontos ou horário não existem. Uma leitura preserva todos os campos JSON existentes e acrescenta/substitui somente `tensao` e `atualizado_em` do player correspondente. Um trigger atualiza `updated_at` e incrementa `revisao` em cada mudança.

Estados: **aguardando**, **rodando**, **pausado**. Leituras em testes aguardando ou pausados retornam **409** e não mudam os valores. Iniciar/retomar habilita os envios novamente.

### Rodadas e concorrência

`finalizar_rodada(p_teste_id, p_rodada_esperada)`:

1. Exige login e propriedade do teste.
2. Obtém `SELECT ... FOR UPDATE` no teste.
3. Confere o número esperado e se o status é `rodando`.
4. Salva o snapshot dos dois jogadores no histórico.
5. Incrementa a rodada e remove apenas `tensao`/`atualizado_em` dos JSONs atuais.
6. Preserva pontos, outros campos e status `rodando`.

Tudo acontece na mesma transação. A RPC de leitura e a rotação de tokens usam o mesmo lock do teste. Isso evita mistura de snapshots e perda de dados entre jogadores. Duas finalizações da mesma rodada produzem uma confirmação e um conflito **409**, sem pular rodadas. Uma leitura concorrente pertence à rodada em que adquire o lock no servidor; o firmware não envia timestamps ou números de rodada.

O escopo não define uma regra para pontos ou vencedor. Portanto, não foi inventada uma: pontos existentes são preservados, e `resultado` registra `finalizado_por`. A regra futura deve ser implementada na transação do servidor. É permitido fechar uma rodada ainda sem leitura; o snapshot preserva exatamente o estado existente.

### Realtime

O navegador busca o estado inicial e depois assina:

```ts
{ event: 'UPDATE', schema: 'public', table: 'testes', filter: `id=eq.${id}` }
```

Ao receber `SUBSCRIBED`, consulta novamente o estado para cobrir o intervalo entre a busca inicial e a abertura do canal. Também recupera o estado ao reconectar, voltar à aba ou voltar à internet. Isso é sincronização orientada a eventos, **não polling**. `revisao` impede uma resposta HTTP atrasada de sobrescrever um evento mais recente. O canal é removido ao sair do teste ou encerrar a sessão.

O histórico é consultado ao conectar e quando o número da rodada aumenta, sem uma consulta por leitura. Lista e histórico exibem até 100 registros recentes. Não é um armazenamento de todas as amostras: `testes` guarda apenas a última leitura de cada player; `rodadas`, apenas snapshots finalizados.

## Segurança e acesso

- Frontend: somente URL e publishable key (ou anon JWT compatível). A configuração rejeita uma chave `sb_secret_` ou JWT `service_role`.
- ESP32: somente token de dispositivo de escopo restrito ao teste e player.
- Edge Function: usa `SUPABASE_SERVICE_ROLE_KEY` exclusivamente nas variáveis de ambiente do servidor, para chamar `registrar_tensao`.
- Todas as tabelas têm RLS. `anon` não lê testes ou histórico e não chama RPCs administrativas.
- Proprietário cria e administra seus testes. Participante pode ler estado/histórico, inclusive via Realtime, sem administrar.
- Clientes autenticados não podem editar estado, forjar histórico, transferir propriedade ou consultar hashes de dispositivos diretamente.
- As funções privilegiadas ficam no schema não exposto `private`, com `search_path` fixo e validação explícita de `auth.uid()`/propriedade. Wrappers públicos são `SECURITY INVOKER`, com grants de execução explícitos.

A função HTTP usa `verify_jwt = false` porque o dispositivo utiliza autenticação própria em **X-Device-Token**, validada atomicamente pela RPC. A publishable key não é uma senha de dispositivo e não substitui esse token. Desabilitar a validação JWT do gateway não torna a escrita anônima: token ausente/incorreto recebe **401**. A RPC interna aceita somente `service_role`.

Gerar um novo token no painel revoga o anterior daquele player. O outro player continua funcionando. Não salve firmware com Wi-Fi/tokens reais no Git ou em um projeto público Wokwi.

### Permitir que outra pessoa acompanhe

O responsável pelo Supabase cria a conta do participante e executa no SQL Editor:

```sql
insert into public.teste_participantes (teste_id, user_id)
values ('UUID_DO_TESTE', 'UUID_DO_USUARIO')
on conflict do nothing;
```

Compartilhe a URL `/testes/UUID_DO_TESTE`; a pessoa deve fazer login. Para retirar o acesso, remova somente essa associação. Não exponha o schema `private` nas configurações da Data API.

## Configurar outro projeto Supabase

Requisitos: Node.js **22.12+** ou **24+**, npm, projeto Supabase e conta com permissão de administração. Docker só é necessário para executar uma stack Supabase local; o frontend pode usar o projeto hospedado diretamente.

```powershell
npm ci
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
npx supabase functions deploy receber-tensao --project-ref SEU_PROJECT_REF --use-api
```

`db push` aplica somente migrations pendentes. Antes de aplicá-las em outro banco existente, verifique conflitos de nomes. Nunca execute `db reset` no banco remoto. A versão da CLI usada pelo projeto fica fixa no `package-lock.json`.

Se sua rede impedir a conexão PostgreSQL da CLI, use o **SQL Editor** para executar a migration uma única vez, e registre sua versão com `npx supabase migration repair 20260910151138 --status applied --linked` quando a conexão estiver disponível. Não misture reaplicação manual com migrations já registradas.

### Passos no painel

1. Em **Authentication → Users**, crie/identifique a conta que administrará os testes. Login por e-mail/senha deve estar habilitado.
2. Em configurações da Data API, mantenha `public` exposto e `private` não exposto.
3. Em **Database → Publications**, confirme que `public.testes` está em `supabase_realtime`. A migration já faz isso por SQL.
4. Em **Edge Functions**, confirme `receber-tensao` ativa. Não habilite a verificação de JWT legado nessa função: ela autentica dispositivos com token próprio.
5. Se futuramente usar links de autenticação por e-mail, configure Site URL e Redirect URLs para o endereço do frontend. O login por senha atual não depende desses redirecionamentos.

### Secrets da Edge Function

Nos projetos hospedados, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são provisionadas pelo Supabase no ambiente da função. Não coloque valores reais no repositório, no frontend, em arquivos públicos ou no firmware. Não é necessário criar um secret global de dispositivos: cada player tem um token individual.

Para ambiente local, `npx supabase start` e `npx supabase functions serve receber-tensao` usam a configuração da stack local. Nunca prefixe uma variável administrativa com `VITE_`. As variáveis `VITE_` são incluídas no bundle público.

## Variáveis do frontend

Copie `.env.example` para `.env.local` **na raiz**:

```dotenv
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUBSTITUA
```

O Vite usa `envDir: '..'`. Reinicie `npm run dev` após alterar essas variáveis.

```powershell
npm run dev
npm run build
npm run preview --workspace frontend
```

O build fica em `frontend/dist`. Hospede como SPA com fallback de `/testes/*` para `/index.html`. Há `_redirects` para provedores que o suportam; em outros, configure a regra equivalente. A publicação pública do frontend não faz parte do provisionamento Supabase realizado aqui.

## Criar um teste por SQL

A interface cria o registro automaticamente com o usuário atual como proprietário. Se preferir o SQL Editor:

```sql
insert into public.testes (nome, owner_id)
values ('Teste 01', 'UUID_DO_USUARIO_AUTH')
returning id;
```

Use `auth.users.id`, não a ID de outro cadastro de perfil. Abra `/testes/UUID_RETORNADO`, entre com o proprietário, gere os tokens e inicie o teste.

## Testar sem ESP32

Os exemplos abaixo são para Bash/Git Bash. No PowerShell, use o exemplo seguinte com `Invoke-RestMethod`.

```bash
URL='https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao'
TESTE_ID='UUID_DO_TESTE'
TOKEN_P1='TOKEN_PLAYER_1'
TOKEN_P2='TOKEN_PLAYER_2'

curl -i -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "X-Device-Token: $TOKEN_P1" \
  -d "{\"teste_id\":\"$TESTE_ID\",\"player\":1,\"tensao\":2.81}"

curl -i -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "X-Device-Token: $TOKEN_P2" \
  -d "{\"teste_id\":\"$TESTE_ID\",\"player\":2,\"tensao\":1.94}"
```

PowerShell:

```powershell
$apiUrl = 'https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao'
$deviceToken = 'TOKEN_PLAYER_1'
$payload = @{ teste_id = 'UUID_DO_TESTE'; player = 1; tensao = 2.81 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $apiUrl -ContentType 'application/json' `
  -Headers @{ 'X-Device-Token' = $deviceToken } -Body $payload
```

Resposta esperada, com número real da rodada:

```json
{ "ok": true, "teste_id": "...", "player": 1, "rodada": 1, "tensao": 2.81 }
```

Validação: UUID obrigatório; player numérico `1` ou `2`; tensão finita, numérica, não negativa; sem campos extras. O payload deve ser JSON com até 1024 bytes. Erros: **400** inválido, **401** token inválido, **404** teste inexistente, **409** aguardando/pausado, **413** corpo grande, **415** tipo de conteúdo incorreto, **500/503** falha no serviço.

### Finalizar uma rodada por curl

Prefira o botão **Finalizar rodada → Salvar e avançar**. Para integrar outro cliente autenticado, use o JWT de sessão desse usuário (nunca a service role):

```bash
curl -i -X POST 'https://SEU_PROJETO.supabase.co/rest/v1/rpc/finalizar_rodada' \
  -H 'Content-Type: application/json' \
  -H 'apikey: SUA_PUBLISHABLE_KEY' \
  -H 'Authorization: Bearer JWT_DA_SESSAO_DO_PROPRIETARIO' \
  -d '{"p_teste_id":"UUID_DO_TESTE","p_rodada_esperada":1}'
```

Informe a rodada atualmente exibida. Um número antigo recebe **409**. Um participante/intruso recebe **403**. Para iniciar/pausar via API, use `alterar_status` com `p_teste_id` e `p_status` (`rodando` ou `pausado`).

## ESP32 e ADC

O firmware usa bibliotecas do próprio Arduino-ESP32: `WiFi.h`, `HTTPClient.h`, `WiFiClientSecure.h` e `time.h`. Não precisa instalar biblioteca de JSON. O certificado público em `certificados.h` valida o servidor HTTPS; SNTP sincroniza o relógio. Não há `setInsecure()`.

Configure no início de `esp32/sketch.ino`:

| Variável | Valor |
| --- | --- |
| `WIFI_SSID` / `WIFI_PASSWORD` | Sua rede; no Wokwi, `Wokwi-GUEST` / senha vazia. |
| `API_URL` | URL completa da Edge Function, copiada do painel. |
| `TESTE_ID` | UUID do teste criado. |
| `PLAYER_ID` | `1` no primeiro ESP32 e `2` no segundo. |
| `DEVICE_TOKEN` | Token gerado especificamente para esse player. |
| `INTERVALO_ENVIO` | Começa em `1000` ms; pode usar `500`. |

GPIO **34**, ADC de **12 bits**, conversão solicitada:

```cpp
float tensao = leitura * (3.3 / 4095.0);
```

Essa é uma aproximação simples, sem calibração avançada. **Não conecte mais de 3,3 V diretamente ao GPIO.** Para uma fonte de aproximadamente 3,6 V, use divisor resistivo dimensionado para manter a entrada abaixo de 3,3 V e GND comum. Esta versão mostra a tensão **no ADC**; não compensa a razão do divisor. A tensão física e a faixa útil do ADC real podem diferir do valor idealizado do simulador.

O Serial a **115200 baud** mostra:

```text
Tensao: 2.810 V | HTTP: 200
```

Há timeouts HTTP/TLS, reconexão Wi-Fi a cada 5 s quando necessário e novas tentativas após falhas. O intervalo é contado após a tentativa HTTP, portanto não gera rajadas compensatórias após um timeout. A latência de HTTPS pode tornar a taxa real menor que uma amostra por intervalo. O ESP32 não usa banco diretamente, WebSocket, rodadas ou pontuação.

As CAs são públicas, obtidas de [Google Trust Services](https://pki.goog/repository/). Se o provedor trocar a cadeia de certificados, atualize `certificados.h` com as CAs oficiais e valide novamente; não desative a verificação HTTPS.

### Arduino IDE

Instale o pacote **esp32 by Espressif Systems** usando o índice oficial:
`https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
Selecione **ESP32 Dev Module**. Como a Arduino IDE exige o nome da pasta igual ao sketch principal, copie `sketch.ino` e `certificados.h` para uma pasta chamada `sketch`, abra o arquivo e compile/carregue. Selecione a porta serial da sua placa.

## Wokwi

1. Crie um projeto **ESP32** em [Wokwi](https://wokwi.com/projects/new/esp32).
2. Substitua `sketch.ino` e `diagram.json` pelos arquivos de `esp32/`.
3. Adicione um arquivo `certificados.h` e copie seu conteúdo completo.
4. Mantenha `WIFI_SSID = "Wokwi-GUEST"` e senha vazia.
5. Configure `API_URL`, `TESTE_ID`, `PLAYER_ID = 1` e o token do Player 1.
6. No painel web, clique em **Iniciar teste**; inicie a simulação e gire o potenciômetro.
7. Confira o Serial e a alteração do valor no navegador.
8. Abra uma segunda simulação/projeto com o mesmo UUID, `PLAYER_ID = 2` e o token do Player 2. Gire os dois potenciômetros para testar envios simultâneos.

O circuito já liga **VCC → 3V3**, **GND → GND** e **SIG → GPIO 34**. O desenho contém apenas um ESP32 e um potenciômetro porque cada simulação representa um player.

A Edge Function precisa estar acessível **pela internet**. `localhost` no seu computador não é acessível pelo gateway público do Wokwi. O HTTPS e a sincronização NTP também precisam de saída de rede. Use tokens descartáveis para simulações compartilhadas e gere novos tokens depois.

## Verificação e testes

```powershell
npm run build
npm run lint
npm test
```

`lint` executa verificação estática TypeScript do frontend e `deno check` na Edge Function. `npm test` cobre validação de UUID/player/tensão, hash do token, corpo inválido/grande, CORS, métodos HTTP e tratamento de erros. Esses testes unitários usam uma dependência controlada; a aplicação entregue sempre usa o Supabase real.

Execute `supabase/tests/monitoramento.sql` no SQL Editor (ou `npx supabase db query --linked --file supabase/tests/monitoramento.sql`). A suíte cria dados temporários, testa permissões e invariantes e termina com **ROLLBACK**. Use um ambiente apropriado de testes para execução repetida.

Teste do navegador com uma conta dedicada do projeto:

```powershell
npx playwright install chromium
$env:E2E_EMAIL = 'EMAIL_DA_CONTA_DE_QA'
$env:E2E_PASSWORD = 'SENHA_DA_CONTA_DE_QA'
npm run test:e2e
```

O teste cria um registro real com nome `Teste de validação`, gera tokens e envia leituras reais. Use conta dedicada; depois remova seus testes no painel administrativo do banco. Sem credenciais, ele é explicitamente marcado como ignorado. Screenshots e saídas de QA ficam na pasta temporária do sistema, fora do código. Nunca use sua conta administrativa pessoal nessa automação.

Fluxo verificado: login → criar teste → gerar os dois tokens → iniciar → POST simultâneo dos dois players → atualização WebSocket → finalização concorrente → histórico → pausa/retomada → queda/recuperação da rede → recarga da rota → sair. Layout inspecionado em **1440×1000** e **390×844**, sem overflow horizontal da página; a tabela permite rolagem horizontal própria no celular.

Para conferir manualmente Realtime, mantenha `/testes/UUID` aberta e envie curl com tensões diferentes. Os números/horários devem mudar sem atualizar a página. Em DevTools → Network → WS, confirme a conexão com `realtime/v1/websocket`. Não existe consulta de estado em intervalo fixo.

### Decisões e limites da validação

- Backend publicado e testado no projeto fornecido; os testes não precisam de ESP32 físico.
- Firmware compilado com **Arduino-ESP32 3.3.11**, alvo `esp32:esp32:esp32`: 1.055.688 bytes de programa (80%) e 48.608 bytes de RAM estática (14%). A compilação usou os arquivos entregues, ainda com os campos de configuração a preencher.
- UI comparada à referência visual: cabeçalho, cores, controles, painéis, tipografia, histórico e organização responsiva. Valores/horários vêm do banco; pontos permanecem `--` quando não configurados.
- O navegador integrado não estava disponível; a inspeção usou Playwright Chromium.
- A simulação Wokwi e a execução em placa física não foram realizadas nesta entrega; os arquivos estão preparados e a compilação foi verificada. Teste o circuito real e o acesso à internet no Wokwi conforme as instruções acima.
- Advisors apontaram um aviso informativo esperado em `private.dispositivos`: RLS sem policies para clientes, pois a tabela deve permanecer inacessível a eles.
- O projeto já tinha avisos em `public.touch_updated_at` (search_path), `public.is_admin` e `public.rls_auto_enable` (execução de funções definer), além de proteção contra senhas vazadas desabilitada. Essas estruturas anteriores foram preservadas. Consulte [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [execução de funções definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) e [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Referências oficiais

- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [ADC no Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html)
- [Rede Wi-Fi do Wokwi](https://docs.wokwi.com/guides/esp32-wifi)
