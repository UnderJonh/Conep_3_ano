#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "certificados.h"

// Configuração simples. Nunca coloque service_role neste firmware.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* API_URL = "https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao";
const char* TESTE_ID = "UUID_DO_TESTE";
const int PLAYER_ID = 1;  // 1 no primeiro ESP32; 2 no segundo.
const char* DEVICE_TOKEN = "TOKEN_GERADO_NO_PAINEL_PARA_ESTE_PLAYER";
const unsigned long INTERVALO_ENVIO = 1000;  // Pode alterar para 500 ms.

const int PINO_ADC = 34;
unsigned long ultimoEnvio = 0;
unsigned long ultimaReconexao = 0;

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

  // NUNCA conecte mais de 3.3 V diretamente ao GPIO!
  // Para medir aproximadamente 3.6 V, use divisor resistivo no hardware.
  // Esta versão informa a tensão no ADC, sem compensar/calibrar o divisor.
  const int leitura = analogRead(PINO_ADC);
  const float tensao = leitura * (3.3 / 4095.0);

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
    const String payload = String("{\"teste_id\":\"") + TESTE_ID +
      "\",\"player\":" + String(PLAYER_ID) + ",\"tensao\":" + String(tensao, 3) + "}";
    codigo = http.POST(payload);
    if (codigo >= 400) Serial.println(http.getString());
    http.end();
  }
  Serial.printf("Tensao: %.3f V | HTTP: %d\n", tensao, codigo);
  // Mesmo com timeout HTTP, aguarda o intervalo antes da próxima tentativa.
  ultimoEnvio = millis();
}
