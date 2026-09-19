/**
 * @file sketch.ino
 * @brief Firmware que lê o sensor de pressão e envia as amostras ao jogo.
 *
 * Visão geral do fluxo:
 *
 *   sensor -> ADC do ESP32 -> tarefa `amostrar` -> fila na RAM
 *          -> `loop` -> JSON -> HTTPS -> Edge Function do Supabase
 *
 * Este firmware somente adquire e transmite dados. A identificação de uma
 * pisada válida, a movimentação da galinha, a pontuação e o ranking são
 * responsabilidades do servidor e do navegador.
 *
 * Há dois fluxos executados de forma concorrente:
 *
 * 1. `amostrar` lê o ADC a cada 20 ms e guarda o resultado em uma fila.
 * 2. `loop` retira amostras da fila e envia um lote a cada 200 ms.
 *
 * A separação é importante porque uma requisição HTTPS pode levar vários
 * segundos. Sem a tarefa de aquisição, os pulsos ocorridos durante esse tempo
 * não seriam observados.
 */

// Controla o rádio Wi-Fi do ESP32 e informa o estado da conexão.
#include <WiFi.h>

// Monta e executa a requisição HTTP POST.
#include <HTTPClient.h>

// Adiciona TLS ao cliente de rede para que a comunicação seja HTTPS.
#include <WiFiClientSecure.h>

// Fornece time(), usado para verificar se o relógio já foi sincronizado.
#include <time.h>

// Fornece gettimeofday(), usado para obter horário Unix com milissegundos.
#include <sys/time.h>

// Núcleo do sistema operacional de tempo real utilizado pelo ESP32.
#include <freertos/FreeRTOS.h>

// API da fila que transporta amostras entre a tarefa e o loop principal.
#include <freertos/queue.h>

// API de tarefas e de temporização periódica do FreeRTOS.
#include <freertos/task.h>

// Declara ROOT_CA, conjunto de autoridades certificadoras confiáveis.
#include "certificados.h"

/*
 * CONFIGURAÇÃO DA PLACA
 * ---------------------
 * O frontend gera um `config.h` particular para cada configuração da placa.
 * Como ele contém senha de Wi-Fi e token, o arquivo não deve ser versionado.
 *
 * `__has_include` permite usar automaticamente esse arquivo quando presente.
 * Os valores do bloco `#else` são apenas padrões para simulação e orientação;
 * uma placa real precisa receber os valores válidos gerados pela aplicação.
 *
 * IMPORTANTE: nunca coloque a chave `service_role` do Supabase no firmware.
 * Ela dá acesso administrativo ao projeto. A placa deve possuir somente seu
 * `DEVICE_TOKEN`, que pode ser substituído/revogado pela aplicação.
 */
#if __has_include("config.h")
#include "config.h"
#else
// Nome da rede Wi-Fi de 2,4 GHz. ESP32 clássico não se conecta a redes de 5 GHz.
const char* WIFI_SSID = "Wokwi-GUEST";

// Senha da rede. Wokwi-GUEST não utiliza senha, por isso o padrão é vazio.
const char* WIFI_PASSWORD = "";

// Endereço da Edge Function que recebe os lotes de tensão.
const char* API_URL = "https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao";

// UUID da sessão/conexão à qual as amostras desta placa pertencem.
const char* TESTE_ID = "UUID_DO_TESTE";

// O modo atual do Crossy Road aceita uma única placa, sempre como jogador 1.
const int PLAYER_ID = 1;

// Credencial exclusiva da placa, enviada no cabeçalho X-Device-Token.
const char* DEVICE_TOKEN = "TOKEN_GERADO_NA_CONFIGURACAO_DO_ESP32";

// GPIO ligado ao sinal analógico. O diagrama Wokwi usa o ADC1 no GPIO 34.
const int PINO_ADC = 34;
#endif

// Menor intervalo, em milissegundos, entre tentativas normais de envio HTTP.
const unsigned long INTERVALO_ENVIO = 200;

// Período de leitura do sensor: 20 ms equivalem a 50 amostras por segundo.
const unsigned long INTERVALO_AMOSTRA = 20;

/*
 * ESTADO MANTIDO ENQUANTO A PLACA ESTÁ LIGADA
 *
 * `millis()` retorna unsigned long e volta a zero após aproximadamente 49,7
 * dias. As subtrações usadas neste firmware continuam corretas nessa virada,
 * desde que os intervalos comparados sejam muito menores que esse período.
 */

// Valor de millis() da última tentativa de envio de lote.
unsigned long ultimoEnvio = 0;

// Valor de millis() da última chamada manual a WiFi.reconnect().
unsigned long ultimaReconexao = 0;

/** Uma leitura pronta para ser transferida da tarefa de ADC ao loop. */
struct Amostra {
  // Instante da leitura no padrão Unix: milissegundos desde 01/01/1970 UTC.
  int64_t instante;

  // Tensão aproximada calculada a partir do valor bruto do conversor ADC.
  float tensao;
};

// Referência da fila FreeRTOS. É criada no setup e comporta 100 amostras.
QueueHandle_t fila;

/**
 * Retorna o horário Unix atual com resolução de milissegundos.
 *
 * `gettimeofday` preenche:
 * - `tv_sec`: segundos inteiros desde 01/01/1970;
 * - `tv_usec`: microssegundos restantes dentro do segundo atual.
 *
 * A multiplicação converte segundos em milissegundos e a divisão converte a
 * parcela de microssegundos. O resultado é `int64_t` porque um inteiro de
 * 32 bits não comporta o horário Unix atual em milissegundos.
 *
 * Antes da sincronização SNTP, esse valor não é confiável. Por isso a tarefa
 * de aquisição só chama esta função depois de validar `time(nullptr)`.
 */
int64_t instanteMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return int64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

/**
 * Tarefa FreeRTOS que amostra continuamente o pino analógico.
 *
 * O parâmetro `void*` é exigido pela assinatura de tarefas FreeRTOS, mas não é
 * necessário neste caso. A tarefa nunca retorna: seu corpo é um laço infinito.
 *
 * A tarefa produz dados; `loop()` é o consumidor. A fila torna segura a troca
 * de dados entre os dois fluxos e impede que a espera de rede pause o ADC.
 */
void amostrar(void*) {
  // Referência usada por vTaskDelayUntil para manter uma frequência estável.
  TickType_t anterior = xTaskGetTickCount();

  while (true) {
    /*
     * 1700000000 representa 14/11/2023 em horário Unix. Não é uma data de
     * validade do sistema; é apenas um valor de referência que distingue um
     * relógio sincronizado do valor incorreto existente logo após o boot.
     * Sem esta proteção, a placa enviaria amostras com datas próximas de 1970.
     */
    if (time(nullptr) >= 1700000000) {
      /*
       * Limite elétrico: o GPIO do ESP32 não tolera mais de 3,3 V.
       * Se o sensor puder gerar tensão maior, use um divisor resistivo ou
       * condicionador no circuito; software não protege contra sobretensão.
       */
      const int leitura = analogRead(PINO_ADC);

      /*
       * Com resolução de 12 bits, `analogRead` retorna de 0 a 4095.
       * A regra de três abaixo estima 0..3,3 V. É uma aproximação: o ADC real
       * do ESP32 tem tolerâncias e não linearidade; medições precisas exigem
       * calibração para a placa e para o sensor específicos.
       */
      Amostra a = {
        instanteMs(),
        float(leitura * (3.3 / 4095.0))
      };

      /*
       * Tempo de espera zero significa "tente inserir imediatamente". Assim,
       * a aquisição nunca fica bloqueada aguardando espaço na fila.
       */
      if (xQueueSend(fila, &a, 0) != pdTRUE) {
        /*
         * Se as 100 posições estiverem ocupadas, remove a amostra mais antiga
         * e insere a atual. Dessa forma, uma falha prolongada de rede conserva
         * o trecho mais recente do sinal, e não dados antigos.
         */
        Amostra antiga;
        xQueueReceive(fila, &antiga, 0);
        xQueueSend(fila, &a, 0);
      }
    }

    /*
     * Suspende a tarefa até o próximo instante periódico. Diferentemente de
     * delay(20), esta função considera o tempo gasto na própria leitura e
     * reduz o desvio acumulado entre amostras.
     */
    vTaskDelayUntil(&anterior, pdMS_TO_TICKS(INTERVALO_AMOSTRA));
  }
}

/**
 * Executado uma única vez após ligar ou reiniciar o ESP32.
 *
 * Inicializa, nesta ordem: Monitor Serial, ADC, Wi-Fi, sincronização de hora,
 * fila de amostras e tarefa de aquisição.
 */
void setup() {
  // Deve coincidir com 115200 baud selecionados no Monitor Serial.
  Serial.begin(115200);

  // Declara o GPIO configurado como entrada; ele nunca será energizado pelo ESP.
  pinMode(PINO_ADC, INPUT);

  // Define leituras de 12 bits: 4096 níveis possíveis, numerados de 0 a 4095.
  analogReadResolution(12);

  /*
   * A atenuação amplia a faixa mensurável do ADC para perto de 3,3 V.
   * O limite elétrico do GPIO continua sendo 3,3 V.
   */
  analogSetPinAttenuation(PINO_ADC, ADC_11db);

  // STA (station) conecta o ESP32 a um roteador; não cria um ponto de acesso.
  WiFi.mode(WIFI_STA);

  // Solicita à biblioteca que tente recuperar automaticamente quedas de Wi-Fi.
  WiFi.setAutoReconnect(true);

  // Inicia a conexão de modo assíncrono; o loop verificará quando ela terminar.
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  /*
   * Inicia SNTP em segundo plano usando dois servidores públicos redundantes.
   * Offset UTC e horário de verão ficam em zero porque timestamps Unix são UTC.
   * Hora correta é necessária tanto no JSON quanto para validar a vigência dos
   * certificados apresentados durante a conexão HTTPS.
   */
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  /*
   * Cria 100 posições, cada uma exatamente do tamanho de `Amostra`.
   * A 20 ms por leitura, a capacidade física representa cerca de 2 segundos.
   */
  fila = xQueueCreate(100, sizeof(Amostra));

  /*
   * Cria a tarefa com:
   * - função executada: amostrar;
   * - nome de diagnóstico: "adc";
   * - pilha: 3072 bytes na implementação FreeRTOS do ESP32;
   * - parâmetro: nullptr, pois a função não recebe configuração extra;
   * - prioridade: 1;
   * - handle de saída: nullptr, pois não será necessário controlá-la depois.
   *
   * O operador || usa curto-circuito: se a fila falhar, não tenta criar uma
   * tarefa que dependeria de uma fila inválida.
   */
  if (!fila ||
      xTaskCreate(amostrar, "adc", 3072, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("Falha ao iniciar captura. Reiniciando...");
    delay(1000);  // Dá tempo para a mensagem sair pela porta serial.
    ESP.restart();
  }
}

/**
 * Laço principal do Arduino, repetido indefinidamente após `setup()`.
 *
 * Ele gerencia conexão, agrupa amostras recentes, gera o JSON e faz o POST.
 * Os retornos antecipados mantêm o fluxo simples: quando um pré-requisito não
 * está pronto, esta iteração termina e o framework chama `loop()` novamente.
 */
void loop() {
  // Tempo desde o boot; adequado para intervalos, mas não para data/hora real.
  const unsigned long agora = millis();

  // Não tenta HTTPS enquanto a interface Wi-Fi estiver desconectada.
  if (WiFi.status() != WL_CONNECTED) {
    // Limita a tentativa manual a uma a cada 5 segundos para não sobrecarregar.
    if (agora - ultimaReconexao >= 5000) {
      ultimaReconexao = agora;
      Serial.println("Reconectando ao Wi-Fi...");
      WiFi.reconnect();
    }

    // Cede tempo às tarefas internas do ESP32 e encerra esta iteração.
    delay(10);
    return;
  }

  // Respeita os 200 ms mínimos entre lotes em condições normais.
  if (agora - ultimoEnvio < INTERVALO_ENVIO) {
    delay(5);
    return;
  }
  ultimoEnvio = agora;

  // HTTPS e instante_ms dependem de uma hora de sistema plausível.
  if (time(nullptr) < 1700000000) {
    Serial.println("Aguardando sincronizacao de hora para HTTPS...");
    return;
  }

  // Protege o contrato atual da API, que admite somente o jogador/placa 1.
  if (PLAYER_ID != 1) {
    Serial.println("Crossy Road usa PLAYER_ID = 1.");
    return;
  }

  /*
   * Começa a montar manualmente o objeto JSON. O início produzido é:
   * {"teste_id":"<uuid>","player":1,"amostras":[
   *
   * Os valores de configuração são gerados pelo sistema e não devem conter
   * aspas. Por isso o firmware não usa aqui uma biblioteca JSON adicional.
   */
  String payload = String("{\"teste_id\":\"") + TESTE_ID +
    "\",\"player\":" + String(PLAYER_ID) + ",\"amostras\":[";

  // Pré-aloca memória para reduzir realocações e fragmentação do heap.
  payload.reserve(3500);

  Amostra a;            // Recebe temporariamente cada item retirado da fila.
  int quantidade = 0;   // Conta quantas amostras válidas entraram no lote.
  float tensao = 0;     // Guarda a última tensão para o diagnóstico serial.

  /*
   * Só aceita os últimos 2 segundos. Isso evita que uma pisada antiga seja
   * reproduzida no jogo quando a conexão voltar após uma interrupção.
   */
  const int64_t corte = instanteMs() - 2000;

  /*
   * Cada lote leva no máximo 50 amostras. `xQueueReceive(..., 0)` também não
   * espera: o laço termina imediatamente quando a fila fica vazia.
   */
  while (quantidade < 50 && xQueueReceive(fila, &a, 0) == pdTRUE) {
    // A retirada é definitiva; amostras vencidas são descartadas de propósito.
    if (a.instante < corte) {
      continue;
    }

    // Insere vírgula antes de todos os itens, exceto o primeiro.
    if (quantidade++) {
      payload += ',';
    }

    /*
     * Um buffer local recebe cada objeto antes de anexá-lo à String:
     * - %.3f limita a tensão a três casas decimais;
     * - %lld imprime o timestamp de 64 bits;
     * - o cast explicita o tipo esperado por snprintf.
     *
     * Exemplo: {"tensao":1.742,"instante_ms":1789823456789}
     */
    char item[90];
    snprintf(
      item,
      sizeof(item),
      "{\"tensao\":%.3f,\"instante_ms\":%lld}",
      a.tensao,
      (long long)a.instante
    );
    payload += item;
    tensao = a.tensao;
  }

  // Não abre uma conexão cara se não houver nenhuma amostra recente para enviar.
  if (!quantidade) {
    return;
  }

  // Fecha o array `amostras` e o objeto JSON principal.
  payload += "]}";

  /*
   * Cliente TLS usado somente nesta requisição. ROOT_CA permite confirmar que
   * o certificado remoto pertence a uma cadeia de confiança conhecida, em vez
   * de desabilitar a validação com setInsecure().
   */
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);

  // Abandona a negociação TLS caso ela leve mais de 8 segundos.
  client.setHandshakeTimeout(8);

  // Camada HTTP que opera sobre o cliente TLS configurado acima.
  HTTPClient http;

  // Tempo máximo para estabelecer conexão TCP/TLS, em milissegundos.
  http.setConnectTimeout(5000);

  // Tempo máximo de espera das operações HTTP, em milissegundos.
  http.setTimeout(5000);

  /*
   * -1 funciona como estado inicial e indica que ainda não houve resposta HTTP.
   * Respostas 2xx representam sucesso; 4xx indicam problema de requisição ou
   * autenticação; 5xx indicam falha no servidor. Valores negativos retornados
   * por POST representam erros locais de transporte da biblioteca HTTPClient.
   */
  int codigo = -1;

  // Associa o cliente seguro ao endereço da Edge Function.
  if (http.begin(client, API_URL)) {
    // Informa ao servidor que o corpo enviado está no formato JSON.
    http.addHeader("Content-Type", "application/json");

    // Autentica a placa sem expor uma chave administrativa do Supabase.
    http.addHeader("X-Device-Token", DEVICE_TOKEN);

    // Envia o corpo e recebe o código HTTP, ou um código negativo de transporte.
    codigo = http.POST(payload);

    // Em erros HTTP, mostra o corpo devolvido pelo servidor para diagnóstico.
    if (codigo >= 400) {
      Serial.println(http.getString());
    }

    // Libera conexão e buffers pertencentes ao objeto HTTPClient.
    http.end();
  }

  // Mostra a última leitura do lote, o resultado do POST e o tamanho do lote.
  Serial.printf(
    "Tensao: %.3f V | HTTP: %d | Amostras: %d\n",
    tensao,
    codigo,
    quantidade
  );

  /*
   * Registra de novo o instante após um erro/timeout. Isso impede uma tentativa
   * de recuperação imediata em rajada. As amostras já retiradas não são
   * recolocadas: se houve dúvida sobre o envio, retransmiti-las poderia gerar
   * um comando duplicado. Dados que envelhecerem serão descartados no lote
   * seguinte pelo corte de 2 segundos.
   */
  if (codigo <= 0 || codigo >= 400) {
    ultimoEnvio = millis();
  }
}
