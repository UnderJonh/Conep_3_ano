# Firmware do ESP32

Este diretório contém a parte do projeto que roda na placa. O ESP32 lê a tensão produzida pelo sensor, mantém as leituras em memória por um curto período e as envia por HTTPS para a Edge Function `receber-tensao`.

O firmware **não decide sozinho quando houve uma pisada**. Ele fornece a sequência de medições; o servidor aplica os limites de força e duração, registra o comando, e o navegador recebe a atualização para mover a galinha.

## Arquivos

| Arquivo | Função |
|---|---|
| `sketch.ino` | Programa principal: configura periféricos, coleta o ADC, gera JSON e envia por HTTPS. |
| `certificados.h` | Autoridades certificadoras públicas usadas para validar a identidade do servidor HTTPS. |
| `diagram.json` | Circuito da simulação Wokwi: placa, potenciômetro, Monitor Serial e fios. |
| `config.h` | Configuração privada gerada pela tela do jogo. Só existe localmente e é ignorada pelo Git. |

## Caminho completo de uma leitura

1. O sensor apresenta uma tensão entre GND e o GPIO analógico.
2. A tarefa FreeRTOS `amostrar` lê o ADC a cada 20 ms, ou 50 vezes por segundo.
3. O valor bruto de 0 a 4095 é convertido aproximadamente para 0 a 3,3 V.
4. A leitura recebe um `instante_ms`, o horário Unix em milissegundos.
5. A estrutura `Amostra` é colocada em uma fila com 100 posições.
6. A cada 200 ms, `loop()` retira até 50 itens recentes da fila.
7. O lote vira um objeto JSON e é enviado por `POST` com o token da placa.
8. A Edge Function autentica a placa e entrega as amostras à lógica do banco.
9. O servidor reconhece uma pisada completa e incrementa o comando do jogador.
10. O navegador recebe esse comando pelo Supabase Realtime e avança a galinha.

Separar aquisição e transmissão evita perder o formato de um pulso enquanto o processador aguarda a rede. Uma chamada HTTPS pode demorar muito mais que os 20 ms entre duas leituras.

## Ligações elétricas

O `diagram.json` representa estas conexões:

| Origem | Destino | Motivo |
|---|---|---|
| Potenciômetro `VCC` | ESP32 `3V3` | Alimenta o componente simulado com 3,3 V. |
| Potenciômetro `GND` | ESP32 `GND.1` | Cria a referência elétrica comum. |
| Potenciômetro `SIG` | ESP32 `D34` | Leva a tensão variável ao ADC configurado em `PINO_ADC`. |
| ESP32 `TX0` | Monitor Serial `RX` | Mostra mensagens e resultados enviados pela placa. |
| ESP32 `RX0` | Monitor Serial `TX` | Completa a interface serial; o firmware atual não lê comandos. |

O potenciômetro apenas simula o sensor no Wokwi. Na montagem física, a saída analógica do sensor ocupa o lugar de `SIG` e os GNDs precisam estar em comum.

> **Limite físico:** nunca aplique mais de 3,3 V ao GPIO. Uma configuração de software, a atenuação do ADC ou a conversão matemática não protege a entrada contra sobretensão. Se o sensor gerar até 3,6 V ou mais, use condicionamento adequado, como um divisor resistivo dimensionado para o sensor.

O GPIO 34 é uma boa escolha no ESP32 clássico porque é entrada e pertence ao ADC1. Ao trocar `PINO_ADC`, escolha um pino ADC1 compatível com a placa: pinos do ADC2 entram em conflito com o Wi-Fi em variantes clássicas do ESP32. Confira também a pinagem da placa real, pois ela pode diferir do modelo Wokwi.

## Bibliotecas importadas

| Inclusão | O que fornece |
|---|---|
| `WiFi.h` | Conexão a uma rede Wi-Fi, consulta de estado e reconexão. |
| `HTTPClient.h` | Construção do `POST`, cabeçalhos, timeouts e código de resposta HTTP. |
| `WiFiClientSecure.h` | Transporte TLS, a camada criptográfica de HTTPS. |
| `time.h` | `time()`, usado como teste simples de sincronização do relógio. |
| `sys/time.h` | `gettimeofday()`, que fornece segundos e microssegundos Unix. |
| `freertos/FreeRTOS.h` | Tipos e recursos básicos do sistema de tempo real do ESP32. |
| `freertos/queue.h` | Fila segura para comunicar a tarefa de ADC com o laço principal. |
| `freertos/task.h` | Criação da tarefa e espera periódica com `vTaskDelayUntil`. |
| `certificados.h` | Constante `ROOT_CA`, usada pelo cliente TLS. |

Todas essas bibliotecas, exceto o arquivo local de certificados, fazem parte do ambiente Arduino para ESP32; não são bibliotecas extras do Library Manager.

## Valores de `config.h`

A tela de configuração gera declarações com os seguintes nomes:

| Nome | Tipo | Uso |
|---|---|---|
| `WIFI_SSID` | `const char*` | Nome da rede Wi-Fi de 2,4 GHz. |
| `WIFI_PASSWORD` | `const char*` | Senha da rede. |
| `API_URL` | `const char*` | URL completa da Edge Function `receber-tensao`. |
| `TESTE_ID` | `const char*` | UUID que relaciona a placa à sessão criada no banco. |
| `PLAYER_ID` | `const int` | Identificador da placa; neste jogo deve ser exatamente `1`. |
| `DEVICE_TOKEN` | `const char*` | Segredo limitado da placa, enviado no cabeçalho `X-Device-Token`. |
| `PINO_ADC` | `const int` | Número do GPIO ADC1 ligado ao sensor. |

O teste `#if __has_include("config.h")` faz o compilador preferir esses valores. Se o arquivo não existir, o bloco `#else` mantém valores demonstrativos que funcionam para a rede aberta do Wokwi, mas não apontam para um projeto Supabase real.

`config.h` não deve ser enviado ao Git, publicado em capturas de tela ou compartilhado. Ele possui a senha do Wi-Fi e o token da placa. Mesmo assim, o token nunca deve ser substituído por uma chave `service_role`: essa chave possui privilégios administrativos muito maiores que os necessários.

## Constantes e estado global

| Nome | Valor inicial | Significado |
|---|---:|---|
| `INTERVALO_ENVIO` | `200 ms` | Intervalo mínimo entre lotes em operação normal. |
| `INTERVALO_AMOSTRA` | `20 ms` | Período da leitura do ADC. Equivale a 50 Hz. |
| `ultimoEnvio` | `0` | Último instante de tentativa de POST, medido por `millis()`. |
| `ultimaReconexao` | `0` | Último instante de reconexão manual do Wi-Fi. |
| `fila` | criada no `setup` | Handle da fila que liga produtor e consumidor. |

`millis()` mede tempo desde o boot e serve para intervalos. Ele não representa data real. O contador de 32 bits volta a zero depois de aproximadamente 49,7 dias, mas a forma `agora - valorAnterior` usada pelo programa mantém as comparações corretas durante essa virada.

### Estrutura `Amostra`

Cada posição da fila contém:

- `instante`: inteiro assinado de 64 bits com o horário Unix em milissegundos;
- `tensao`: número de ponto flutuante com a tensão estimada.

Um inteiro de 64 bits é necessário porque o horário atual em milissegundos é grande demais para 32 bits. A fila comporta 100 estruturas; a 20 ms por estrutura, ela representa aproximadamente 2 segundos de sinal.

## Funções

### `instanteMs()`

Chama `gettimeofday()` e combina as duas partes do resultado:

```text
instante_ms = (segundos × 1000) + (microssegundos ÷ 1000)
```

O horário só é considerado utilizável quando `time(nullptr)` chega a `1700000000`, correspondente a 14 de novembro de 2023. Essa data é apenas uma sentinela: valores menores normalmente indicam que o SNTP ainda não atualizou o relógio depois do boot. Não é uma data de expiração.

### `amostrar(void*)`

É uma tarefa FreeRTOS independente do `loop()`. Seu ciclo é:

1. confirma que a hora já é plausível;
2. chama `analogRead(PINO_ADC)`;
3. estima a tensão com `leitura × (3,3 / 4095)`;
4. associa o horário atual;
5. tenta inserir a estrutura na fila sem esperar;
6. aguarda o próximo instante de 20 ms.

Se a fila estiver cheia, a tarefa remove exatamente o item mais antigo e tenta inserir a nova leitura. A preferência por dados novos combina com a regra do jogo: depois de uma queda de rede, não é desejável executar pisadas antigas.

`vTaskDelayUntil` mantém a cadência tomando o instante anterior como referência. Isso acumula menos desvio que chamar apenas `delay(20)` depois de cada leitura.

### `setup()`

É executado uma vez por inicialização:

1. abre a Serial a 115200 baud;
2. configura o GPIO como entrada;
3. seleciona resolução ADC de 12 bits;
4. aplica atenuação de 11 dB para ampliar a faixa mensurável;
5. coloca o Wi-Fi em modo estação (`WIFI_STA`);
6. habilita reconexão automática e inicia a conexão;
7. inicia SNTP com dois servidores de horário;
8. cria a fila de 100 amostras;
9. cria a tarefa `adc`, que executa `amostrar` com prioridade 1.

Se a fila ou a tarefa não puder ser criada, continuar seria inseguro porque o firmware não conseguiria capturar os dados. Ele informa a falha, espera um segundo e reinicia com `ESP.restart()`.

### `loop()`

É chamado repetidamente pelo framework Arduino e possui estas proteções, na ordem:

1. **Wi-Fi:** se estiver desconectado, tenta `WiFi.reconnect()` no máximo uma vez a cada 5 segundos e encerra a iteração.
2. **Cadência:** se ainda não passaram 200 ms desde o envio anterior, aguarda brevemente e encerra a iteração.
3. **Hora:** se o SNTP ainda não forneceu hora plausível, não tenta HTTPS nem consome a fila.
4. **Jogador:** recusa configuração diferente de `PLAYER_ID = 1`, conforme o contrato atual do sistema.
5. **Lote:** retira até 50 amostras sem bloquear, ignorando qualquer uma com mais de 2 segundos.
6. **JSON:** fecha o array e o objeto somente se encontrou ao menos uma amostra recente.
7. **TLS/HTTP:** configura certificados e timeouts, adiciona dois cabeçalhos e executa o `POST`.
8. **Diagnóstico:** imprime a última tensão, o código HTTP e o total enviado.

Os pequenos `delay` do `loop()` cedem processamento às tarefas de sistema. Eles não interrompem a aquisição, porque `amostrar` é outra tarefa FreeRTOS.

## Fila, lote e comportamento durante falhas

Em condições normais, surgem aproximadamente 10 amostras entre dois envios: `200 ms ÷ 20 ms = 10`. O limite de 50 por lote dá margem para esvaziar um acúmulo curto sem criar um JSON excessivo.

A política é intencionalmente voltada a tempo real:

- fila cheia: descarta a leitura mais antiga;
- leitura com mais de 2 segundos: descarta antes de montar o JSON;
- lote já retirado e POST com erro: não recoloca os itens na fila;
- erro ou timeout: reinicia a contagem dos 200 ms para evitar tentativas em rajada.

O firmware prefere perder uma leitura durante uma falha a repetir uma pisada antiga ou duvidosa. Não há armazenamento persistente nem confirmação individual de cada amostra.

## JSON e cabeçalhos enviados

Exemplo de corpo com duas leituras:

```json
{
  "teste_id": "12345678-1234-1234-1234-123456789abc",
  "player": 1,
  "amostras": [
    { "tensao": 0.214, "instante_ms": 1789823456769 },
    { "tensao": 1.742, "instante_ms": 1789823456789 }
  ]
}
```

Cabeçalhos:

```http
Content-Type: application/json
X-Device-Token: <token exclusivo da placa>
```

Cada tensão é serializada com três casas decimais. `payload.reserve(3500)` pré-aloca espaço para a `String`, diminuindo o número de expansões de memória durante a montagem do lote.

## HTTPS e `certificados.h`

`ROOT_CA` é uma *raw string* C++ que contém certificados raiz públicos no formato PEM. Esses certificados não são senhas e não identificam a placa. Eles permitem ao ESP32 conferir se o certificado apresentado pelo servidor deriva de uma autoridade confiável.

- `#pragma once` impede que o cabeçalho seja incluído duas vezes na mesma compilação;
- `static const char` torna o conteúdo somente leitura e restrito à unidade compilada;
- `PROGMEM` mantém o grande texto na memória de programa/flash;
- `R"PEM(... )PEM"` permite guardar o PEM com várias linhas sem escapar cada quebra.

O uso de `client.setCACert(ROOT_CA)` mantém a verificação do servidor ativa. Não troque por `setInsecure()`: isso criptografaria o tráfego, mas deixaria a placa incapaz de detectar um servidor impostor.

O pacote precisa ser revisto se o provedor mudar sua cadeia de certificação ou quando uma raiz expirar. A hora SNTP também precisa estar correta para que o ESP32 valide os períodos de vigência dos certificados.

## Monitor Serial

Selecione **115200 baud**. Uma operação normal se parece com:

```text
Tensao: 1.742 V | HTTP: 200 | Amostras: 10
```

Interpretação:

- `Tensao`: última amostra presente naquele lote, não média nem pico;
- `HTTP: 200`: o servidor aceitou a requisição;
- `Amostras`: quantidade de objetos transmitidos no corpo;
- `HTTP: 4xx`: URL, token, sessão ou formato foi recusado; o corpo da resposta aparece na linha anterior;
- `HTTP: 5xx`: a função ou um serviço do servidor falhou;
- código negativo: a biblioteca falhou antes de obter uma resposta HTTP, por exemplo por conexão, TLS ou timeout.

Outras mensagens:

| Mensagem | Causa e reação |
|---|---|
| `Reconectando ao Wi-Fi...` | A interface não está conectada e iniciou nova tentativa. Verifique SSID, senha, sinal e rede de 2,4 GHz. |
| `Aguardando sincronizacao de hora para HTTPS...` | Wi-Fi conectou, mas SNTP ainda não definiu uma hora confiável. |
| `Crossy Road usa PLAYER_ID = 1.` | O `config.h` possui um jogador incompatível e nenhum lote será enviado. |
| `Falha ao iniciar captura. Reiniciando...` | Faltou memória para fila/tarefa; a placa reinicia automaticamente. |

## Conversão do ADC e precisão

A expressão `leitura * (3.3 / 4095.0)` é suficiente para a mecânica relativa do jogo, mas não transforma a placa em um voltímetro calibrado. A tensão real pode diferir por:

- tolerância da referência interna e do divisor do ADC;
- não linearidade do conversor do ESP32;
- impedância e ruído do sensor;
- alimentação da placa e montagem elétrica;
- variação entre unidades de ESP32.

Por isso o frontend permite ajustar a força mínima em volts. Para obter uma medida física em newtons, seria necessário caracterizar o sensor com cargas conhecidas e aplicar uma curva de calibração; o firmware atual não faz essa conversão.

## Parâmetros que podem ser alterados

- `INTERVALO_AMOSTRA`: diminuir captura pulsos mais curtos, mas aumenta uso de CPU, fila e volume de rede. A regra do servidor e a capacidade do sistema também devem ser revistas.
- `INTERVALO_ENVIO`: aumentar reduz requisições, porém acrescenta latência ao movimento. Diminuir faz o oposto.
- capacidade `100` em `xQueueCreate`: aumenta ou reduz a janela em RAM; não muda sozinho o corte de 2 segundos.
- limite `50` do lote: deve continuar compatível com os 3500 bytes reservados e com os limites da Edge Function.
- corte `2000`: controla a idade máxima aceita. Aumentá-lo pode fazer um comando antigo aparecer após reconexão.
- `PINO_ADC`: deve ser alterado pelo arquivo de configuração e precisa apontar para uma entrada ADC1 válida na placa usada.

Ao mudar tempos ou tamanhos, considere o conjunto todo: frequência de aquisição, capacidade da fila, idade máxima, tamanho do lote, limite da requisição e regras de duração da pisada no servidor.
