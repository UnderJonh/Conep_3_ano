/*
 * Firmware do ESP32 para o Crossy Road.
 * Lê a tensão do sensor e envia as amostras por HTTPS para o servidor.
 * A detecção das pisadas e a pontuação são feitas no servidor.
 */

// Bibliotecas de Wi-Fi, HTTP seguro, horário e tarefas do ESP32.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <sys/time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "certificados.h"

/*
 * Usa o config.h gerado pelo jogo quando ele estiver disponível.
 * O bloco abaixo contém apenas valores padrão para o Wokwi.
 * Nunca coloque a chave service_role do Supabase neste firmware.
 */
#if __has_include("config.h")
#include "config.h"
#else
const char* WIFI_SSID = "Wokwi-GUEST";  // Nome da rede Wi-Fi 2,4 GHz.
const char* WIFI_PASSWORD = "";         // Senha da rede.
const char* API_URL = "https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao";
const char* TESTE_ID = "UUID_DO_TESTE"; // Identificador da sessão no banco.
const int PLAYER_ID = 1;                 // O jogo utiliza somente a placa 1.
const char* DEVICE_TOKEN = "TOKEN_GERADO_NA_CONFIGURACAO_DO_ESP32";
const int PINO_ADC = 34;                 // GPIO conectado ao sensor.
#endif

// Intervalos em milissegundos.
const unsigned long INTERVALO_ENVIO = 200;
const unsigned long INTERVALO_AMOSTRA = 20;

// Instantes usados para controlar os envios e as reconexões.
unsigned long ultimoEnvio = 0;
unsigned long ultimaReconexao = 0;

// Uma leitura do sensor, com horário e tensão.
struct Amostra {
  int64_t instante;
  float tensao;
};

// Fila que leva as leituras da tarefa de captura até o loop principal.
QueueHandle_t fila;

// Retorna o horário Unix atual em milissegundos.
int64_t instanteMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return int64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

/*
 * Tarefa de captura do sensor.
 * Ela continua lendo o ADC mesmo quando o loop está aguardando a rede.
 */
void amostrar(void*) {
  TickType_t anterior = xTaskGetTickCount();

  while (true) {
    // Só registra leituras depois que a hora foi sincronizada pela internet.
    if (time(nullptr) >= 1700000000) {
      // O ADC de 12 bits retorna valores de 0 a 4095.
      // Nunca aplique mais de 3,3 V ao GPIO.
      const int leitura = analogRead(PINO_ADC);
      Amostra a = {
        instanteMs(),
        float(leitura * (3.3 / 4095.0))
      };

      // Se a fila estiver cheia, descarta a leitura mais antiga.
      if (xQueueSend(fila, &a, 0) != pdTRUE) {
        Amostra antiga;
        xQueueReceive(fila, &antiga, 0);
        xQueueSend(fila, &a, 0);
      }
    }

    // Mantém uma leitura a cada 20 ms.
    vTaskDelayUntil(&anterior, pdMS_TO_TICKS(INTERVALO_AMOSTRA));
  }
}

// Executado uma vez quando o ESP32 liga.
void setup() {
  Serial.begin(115200);

  // Configura a entrada analógica com resolução de 12 bits.
  pinMode(PINO_ADC, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ADC, ADC_11db);

  // Inicia o Wi-Fi no modo estação.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Sincroniza o relógio, necessário para os horários e para o HTTPS.
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  // A fila comporta 100 leituras, cerca de 2 segundos de dados.
  fila = xQueueCreate(100, sizeof(Amostra));

  // Cria a tarefa que lê o sensor em paralelo com os envios.
  if (!fila ||
      xTaskCreate(amostrar, "adc", 3072, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("Falha ao iniciar captura. Reiniciando...");
    delay(1000);
    ESP.restart();
  }
}

// Executado continuamente depois do setup.
void loop() {
  const unsigned long agora = millis();

  // Tenta reconectar ao Wi-Fi no máximo uma vez a cada 5 segundos.
  if (WiFi.status() != WL_CONNECTED) {
    if (agora - ultimaReconexao >= 5000) {
      ultimaReconexao = agora;
      Serial.println("Reconectando ao Wi-Fi...");
      WiFi.reconnect();
    }
    delay(10);
    return;
  }

  // Envia um lote no máximo a cada 200 ms.
  if (agora - ultimoEnvio < INTERVALO_ENVIO) {
    delay(5);
    return;
  }
  ultimoEnvio = agora;

  if (time(nullptr) < 1700000000) {
    Serial.println("Aguardando sincronizacao de hora para HTTPS...");
    return;
  }

  if (PLAYER_ID != 1) {
    Serial.println("Crossy Road usa PLAYER_ID = 1.");
    return;
  }

  // Inicia o JSON que será enviado ao servidor.
  String payload = String("{\"teste_id\":\"") + TESTE_ID +
    "\",\"player\":" + String(PLAYER_ID) + ",\"amostras\":[";
  payload.reserve(3500);

  Amostra a;
  int quantidade = 0;
  float tensao = 0;
  const int64_t corte = instanteMs() - 2000;

  // Retira até 50 leituras da fila e ignora dados com mais de 2 segundos.
  while (quantidade < 50 && xQueueReceive(fila, &a, 0) == pdTRUE) {
    if (a.instante < corte) {
      continue;
    }
    if (quantidade++) {
      payload += ',';
    }

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

  if (!quantidade) {
    return;
  }
  payload += "]}";

  // Cria a conexão HTTPS e valida o servidor com ROOT_CA.
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setHandshakeTimeout(8);

  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);

  // Envia o JSON com o token que identifica a placa.
  int codigo = -1;
  if (http.begin(client, API_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);
    codigo = http.POST(payload);

    if (codigo >= 400) {
      Serial.println(http.getString());
    }
    http.end();
  }

  // Exibe o resultado no Monitor Serial.
  Serial.printf(
    "Tensao: %.3f V | HTTP: %d | Amostras: %d\n",
    tensao,
    codigo,
    quantidade
  );

  // Após um erro, espera o intervalo normal antes de tentar novamente.
  if (codigo <= 0 || codigo >= 400) {
    ultimoEnvio = millis();
  }
}
