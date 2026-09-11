#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <sys/time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "certificados.h"

// Configuração simples. Nunca coloque service_role neste firmware.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* API_URL = "https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao";
const char* TESTE_ID = "UUID_DO_TESTE";
const int PLAYER_ID = 1;  // 1 no primeiro ESP32; 2 no segundo.
const char* DEVICE_TOKEN = "TOKEN_GERADO_NO_PAINEL_PARA_ESTE_PLAYER";
const unsigned long INTERVALO_ENVIO = 500;
const unsigned long INTERVALO_AMOSTRA = 20;  // Captura pulsos entre os envios HTTP.

const int PINO_ADC = 34;
unsigned long ultimoEnvio = 0;
unsigned long ultimaReconexao = 0;
struct Amostra { int64_t instante; float tensao; };
QueueHandle_t fila;

int64_t instanteMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return int64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

// Só aquisição de dados: pontuação, detecção de pisadas e rodadas ficam no servidor.
// A tarefa continua amostrando enquanto a outra aguarda HTTPS.
void amostrar(void*) {
  TickType_t anterior = xTaskGetTickCount();
  while (true) {
    if (time(nullptr) >= 1700000000) {
      // NUNCA conecte mais de 3.3 V ao GPIO. Para 3.6 V, use divisor no hardware.
      const int leitura = analogRead(PINO_ADC);
      Amostra a = { instanteMs(), float(leitura * (3.3 / 4095.0)) };
      if (xQueueSend(fila, &a, 0) != pdTRUE) {
        Amostra antiga;
        xQueueReceive(fila, &antiga, 0);  // Buffer cheio: conserva os dados mais recentes.
        xQueueSend(fila, &a, 0);
      }
    }
    vTaskDelayUntil(&anterior, pdMS_TO_TICKS(INTERVALO_AMOSTRA));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_ADC, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ADC, ADC_11db);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Hora correta permite validar o certificado HTTPS. SNTP tenta em segundo plano.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  fila = xQueueCreate(100, sizeof(Amostra));
  if (!fila || xTaskCreate(amostrar, "adc", 3072, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("Falha ao iniciar captura. Reiniciando...");
    delay(1000);
    ESP.restart();
  }
}

void loop() {
  const unsigned long agora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (agora - ultimaReconexao >= 5000) {
      ultimaReconexao = agora;
      Serial.println("Reconectando ao Wi-Fi...");
      WiFi.reconnect();
    }
    delay(10);
    return;
  }
  if (agora - ultimoEnvio < INTERVALO_ENVIO) { delay(5); return; }
  ultimoEnvio = agora;
  if (time(nullptr) < 1700000000) {
    Serial.println("Aguardando sincronizacao de hora para HTTPS...");
    return;
  }
  if (PLAYER_ID != 1 && PLAYER_ID != 2) {
    Serial.println("PLAYER_ID precisa ser 1 ou 2.");
    return;
  }

  String payload = String("{\"teste_id\":\"") + TESTE_ID +
    "\",\"player\":" + String(PLAYER_ID) + ",\"amostras\":[";
  payload.reserve(3500);
  Amostra a;
  int quantidade = 0;
  float tensao = 0;
  const int64_t corte = instanteMs() - 2000;
  while (quantidade < 50 && xQueueReceive(fila, &a, 0) == pdTRUE) {
    if (a.instante < corte) continue;  // Não reproduz passos antigos após queda de rede.
    if (quantidade++) payload += ',';
    char item[90];
    snprintf(item, sizeof(item), "{\"tensao\":%.3f,\"instante_ms\":%lld}", a.tensao, (long long)a.instante);
    payload += item;
    tensao = a.tensao;
  }
  if (!quantidade) return;
  payload += "]}";

  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setHandshakeTimeout(8);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  int codigo = -1;
  if (http.begin(client, API_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);
    codigo = http.POST(payload);
    if (codigo >= 400) Serial.println(http.getString());
    http.end();
  }
  Serial.printf("Tensao: %.3f V | HTTP: %d | Amostras: %d\n", tensao, codigo, quantidade);
  // Após timeout não faz rajadas. Dados vencidos são descartados no próximo lote.
  if (codigo <= 0 || codigo >= 400) ultimoEnvio = millis();
}
