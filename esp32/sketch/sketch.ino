/*
 * Firmware ESP32 - Crossy Road
 *
 * - Corrige ESP32 com MAC de fabrica zerado
 * - Le dois sensores, um GPIO ADC por jogador
 * - Armazena amostras em duas filas FreeRTOS independentes
 * - Conecta ao Wi-Fi de forma controlada
 * - Sincroniza horario via NTP
 * - Envia amostras via HTTPS
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <sys/time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <esp_mac.h>
#include <esp_err.h>

#include "certificados.h"

/*
 * Configuracao
 */
#if __has_include("config.h")
#include "config.h"
#else
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

const char* API_URL =
  "https://SEU_PROJETO.supabase.co/functions/v1/receber-tensao";

const char* TESTE_ID = "UUID_DO_TESTE";

const char* DEVICE_TOKEN =
  "TOKEN_GERADO_NA_CONFIGURACAO_DO_ESP32";

const int PINO_ADC_PLAYER_1 = 34;
const int PINO_ADC_PLAYER_2 = 35;
#endif

// ======================================================
// CONFIGURACOES
// ======================================================

const unsigned long INTERVALO_ENVIO = 200;
const unsigned long INTERVALO_AMOSTRA = 20;

const unsigned long TIMEOUT_WIFI = 15000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;

/*
 * Esta placa esta com o MAC de fabrica zerado.
 * Por isso definimos um MAC local valido por software.
 *
 * 02 = endereco localmente administrado e unicast.
 * Se usar outra placa ao mesmo tempo, troque apenas o ultimo byte.
 */
static uint8_t MAC_CUSTOM[6] = {
  0x02, 0x50, 0x4B, 0x58, 0x00, 0x01
};

// ======================================================
// ESTADO
// ======================================================

unsigned long ultimoEnvio = 0;
unsigned long inicioTentativaWiFi = 0;
unsigned long ultimaTentativaWiFi = 0;
unsigned long ultimoAvisoNTP = 0;

volatile bool wifiTentando = false;
volatile bool wifiConectado = false;

bool ntpIniciado = false;

// ======================================================
// AMOSTRAS
// ======================================================

struct Amostra {
  int64_t instante;
  float tensao;
};

QueueHandle_t filas[2];

// ======================================================
// HORARIO
// ======================================================

int64_t instanteMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);

  return int64_t(tv.tv_sec) * 1000LL +
         tv.tv_usec / 1000;
}

// ======================================================
// MAC PERSONALIZADO
// ======================================================

bool configurarMacPersonalizado() {
  Serial.println();
  Serial.println("==============================");
  Serial.println("Configurando MAC personalizado...");

  /*
   * IMPORTANTE:
   * estas chamadas precisam acontecer antes de WiFi.mode(),
   * WiFi.begin() ou qualquer inicializacao da interface de rede.
   */
  esp_err_t rBase = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_BASE);
  esp_err_t rSta  = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_WIFI_STA);

  Serial.print("[MAC] Base: ");
  Serial.println(esp_err_to_name(rBase));

  Serial.print("[MAC] STA:  ");
  Serial.println(esp_err_to_name(rSta));

  if (rBase != ESP_OK || rSta != ESP_OK) {
    Serial.println("[MAC] ERRO ao configurar endereco MAC.");
    Serial.println("==============================");
    return false;
  }

  uint8_t macLido[6] = {0};
  esp_err_t rRead = esp_read_mac(macLido, ESP_MAC_WIFI_STA);

  Serial.print("[MAC] Lido antes do Wi-Fi: ");

  if (rRead == ESP_OK) {
    Serial.printf(
      "%02X:%02X:%02X:%02X:%02X:%02X\n",
      macLido[0], macLido[1], macLido[2],
      macLido[3], macLido[4], macLido[5]
    );
  } else {
    Serial.print("ERRO: ");
    Serial.println(esp_err_to_name(rRead));
  }

  Serial.println("==============================");

  return rRead == ESP_OK &&
         !(macLido[0] == 0 && macLido[1] == 0 && macLido[2] == 0 &&
           macLido[3] == 0 && macLido[4] == 0 && macLido[5] == 0);
}

// ======================================================
// EVENTOS DO WI-FI
// ======================================================

void eventoWiFi(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      Serial.println("[WiFi] Interface iniciada.");
      break;

    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("[WiFi] Associado ao ponto de acesso.");
      break;

    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiTentando = false;
      wifiConectado = true;

      Serial.println();
      Serial.println("==============================");
      Serial.println("WIFI CONECTADO!");

      Serial.print("SSID: ");
      Serial.println(WiFi.SSID());

      Serial.print("MAC: ");
      Serial.println(WiFi.macAddress());

      Serial.print("IP: ");
      Serial.println(WiFi.localIP());

      Serial.print("Gateway: ");
      Serial.println(WiFi.gatewayIP());

      Serial.print("RSSI: ");
      Serial.print(WiFi.RSSI());
      Serial.println(" dBm");

      Serial.println("==============================");
      Serial.println();
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      wifiConectado = false;
      wifiTentando = false;
      ultimaTentativaWiFi = millis();

      Serial.println();
      Serial.print("[WiFi] Desconectado. Motivo: ");
      Serial.println(info.wifi_sta_disconnected.reason);
      break;

    default:
      break;
  }
}

// ======================================================
// INICIAR CONEXAO WI-FI
// ======================================================

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (wifiTentando) {
    return;
  }

  wifiTentando = true;
  inicioTentativaWiFi = millis();
  ultimaTentativaWiFi = millis();

  Serial.println();
  Serial.println("==============================");
  Serial.println("Iniciando conexao Wi-Fi...");

  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);

  Serial.print("MAC STA: ");
  Serial.println(WiFi.macAddress());

  Serial.println("==============================");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ======================================================
// GERENCIAR WI-FI
// ======================================================

bool gerenciarWiFi() {
  const unsigned long agora = millis();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    wifiTentando = false;
    return true;
  }

  wifiConectado = false;

  if (wifiTentando) {
    if (agora - inicioTentativaWiFi > TIMEOUT_WIFI) {
      Serial.println();
      Serial.println("[WiFi] Timeout de conexao.");

      // Cancela apenas esta tentativa. Nao apaga as credenciais.
      WiFi.disconnect(false, false);

      wifiTentando = false;
      ultimaTentativaWiFi = agora;
    }

    return false;
  }

  if (agora - ultimaTentativaWiFi >= INTERVALO_RECONEXAO_WIFI) {
    conectarWiFi();
  }

  return false;
}

// ======================================================
// TAREFA ADC
// ======================================================

void amostrar(void*) {
  TickType_t anterior = xTaskGetTickCount();
  const int pinos[2] = { PINO_ADC_PLAYER_1, PINO_ADC_PLAYER_2 };

  while (true) {
    if (time(nullptr) >= 1700000000) {
      for (int player = 0; player < 2; player++) {
        const int leitura = analogRead(pinos[player]);
        Amostra a = {
          instanteMs(),
          float(leitura) * (3.3f / 4095.0f)
        };

        if (xQueueSend(filas[player], &a, 0) != pdTRUE) {
          Amostra antiga;
          xQueueReceive(filas[player], &antiga, 0);
          xQueueSend(filas[player], &a, 0);
        }
      }
    }

    vTaskDelayUntil(
      &anterior,
      pdMS_TO_TICKS(INTERVALO_AMOSTRA)
    );
  }
}

// ======================================================
// SETUP
// ======================================================

void setup() {
  // Usa 115200 para coincidir com o boot log nativo do ESP32 e facilitar diagnostico.
  Serial.begin(115200);
  delay(1200);

  Serial.println();
  Serial.println();
  Serial.println("==============================");
  Serial.println("ESP32 CROSSY ROAD");
  Serial.println("==============================");
  Serial.print("Reset reason: ");
  Serial.println((int)esp_reset_reason());

  // --------------------------------------------------
  // MAC - TEM QUE VIR ANTES DO WI-FI
  // --------------------------------------------------

  if (!configurarMacPersonalizado()) {
    Serial.println("FALHA CRITICA: MAC nao foi configurado.");
    Serial.println("A placa nao conseguira associar ao Wi-Fi.");

    while (true) {
      delay(1000);
    }
  }

  // --------------------------------------------------
  // ADC
  // --------------------------------------------------

  pinMode(PINO_ADC_PLAYER_1, INPUT);
  pinMode(PINO_ADC_PLAYER_2, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ADC_PLAYER_1, ADC_11db);
  analogSetPinAttenuation(PINO_ADC_PLAYER_2, ADC_11db);

  // --------------------------------------------------
  // FILA
  // --------------------------------------------------

  filas[0] = xQueueCreate(100, sizeof(Amostra));
  filas[1] = xQueueCreate(100, sizeof(Amostra));

  if (!filas[0] || !filas[1]) {
    Serial.println("ERRO: nao foi possivel criar as filas.");
    delay(2000);
    ESP.restart();
  }

  // --------------------------------------------------
  // TAREFA ADC
  // --------------------------------------------------

  if (
    xTaskCreate(
      amostrar,
      "adc",
      3072,
      nullptr,
      1,
      nullptr
    ) != pdPASS
  ) {
    Serial.println("ERRO: nao foi possivel iniciar ADC.");
    delay(2000);
    ESP.restart();
  }

  // --------------------------------------------------
  // WI-FI
  // --------------------------------------------------

  WiFi.onEvent(eventoWiFi);

  // Nao deixa credenciais antigas em NVS influenciarem a tentativa.
  WiFi.persistent(false);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);

  delay(300);

  Serial.print("[MAC] WiFi.macAddress(): ");
  Serial.println(WiFi.macAddress());

  if (WiFi.macAddress() == "00:00:00:00:00:00") {
    Serial.println("FALHA CRITICA: Wi-Fi ainda esta com MAC zerado.");
    while (true) {
      delay(1000);
    }
  }

  conectarWiFi();
}

// ======================================================
// LOOP
// ======================================================

int adicionarAmostras(
  String& payload,
  int player,
  QueueHandle_t filaPlayer,
  bool& primeira,
  float& tensao
) {
  const unsigned int inicio = payload.length();
  if (!primeira) {
    payload += ',';
  }
  payload += String("{\"player\":") + String(player) + ",\"amostras\":[";
  Amostra a;
  int quantidade = 0;
  const int64_t corte = instanteMs() - 2000;

  while (
    quantidade < 50 &&
    xQueueReceive(filaPlayer, &a, 0) == pdTRUE
  ) {
    if (a.instante < corte) {
      continue;
    }

    if (quantidade > 0) {
      payload += ',';
    }

    char item[100];
    snprintf(
      item,
      sizeof(item),
      "{\"tensao\":%.3f,\"instante_ms\":%lld}",
      a.tensao,
      (long long)a.instante
    );
    payload += item;
    tensao = a.tensao;
    quantidade++;
  }

  if (quantidade == 0) {
    payload.remove(inicio);
    return 0;
  }
  payload += "]}";
  primeira = false;
  return quantidade;
}

bool enviarAmostras() {
  String payload;
  payload.reserve(7000);
  payload = String("{\"teste_id\":\"") + TESTE_ID + "\",\"leituras\":[";

  bool primeira = true;
  float tensoes[2] = { 0.0f, 0.0f };
  const int quantidades[2] = {
    adicionarAmostras(payload, 1, filas[0], primeira, tensoes[0]),
    adicionarAmostras(payload, 2, filas[1], primeira, tensoes[1])
  };
  if (primeira) {
    return false;
  }
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
    if (codigo >= 400) {
      Serial.print("[HTTP] Lote dos jogadores: ");
      Serial.println(http.getString());
    }
    http.end();
  }

  Serial.printf(
    "Jogadores: 1+2 | Tensoes: %.3f / %.3f V | HTTP: %d | Amostras: %d / %d | RSSI: %d dBm\n",
    tensoes[0],
    tensoes[1],
    codigo,
    quantidades[0],
    quantidades[1],
    WiFi.RSSI()
  );
  return codigo >= 200 && codigo < 300;
}

void loop() {
  const unsigned long agora = millis();

  // ==================================================
  // WI-FI
  // ==================================================

  if (!gerenciarWiFi()) {
    delay(20);
    return;
  }

  // ==================================================
  // NTP
  // ==================================================

  if (!ntpIniciado) {
    Serial.println("[NTP] Iniciando sincronizacao...");

    configTime(
      0,
      0,
      "pool.ntp.org",
      "time.google.com"
    );

    ntpIniciado = true;
  }

  if (time(nullptr) < 1700000000) {
    if (agora - ultimoAvisoNTP >= 2000) {
      ultimoAvisoNTP = agora;
      Serial.println("[NTP] Aguardando horario...");
    }

    delay(10);
    return;
  }

  // ==================================================
  // INTERVALO DE ENVIO
  // ==================================================

  if (agora - ultimoEnvio < INTERVALO_ENVIO) {
    delay(5);
    return;
  }

  ultimoEnvio = agora;
  enviarAmostras();
}
