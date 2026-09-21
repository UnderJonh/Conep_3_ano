/*
 * Firmware ESP32 - Crossy Road via WebSocket
 *
 * A placa detecta cada pisada localmente e envia somente o comando pronto.
 * A conexao WebSocket permanece aberta, evitando handshakes HTTPS repetidos.
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <time.h>
#include <sys/time.h>
#include <esp_mac.h>
#include <esp_err.h>
#include <esp_system.h>

#include "certificados.h"

#if __has_include("config.h")
#include "config.h"
#else
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* WS_HOST = "SEU_DOMINIO.up.railway.app";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/ws";
const bool WS_SECURE = true;
const char* TESTE_ID = "UUID_DO_TESTE";
const char* DEVICE_TOKEN = "TOKEN_GERADO_NA_CONFIGURACAO_DO_ESP32";
const int PINO_ADC_PLAYER_1 = 34;
const int PINO_ADC_PLAYER_2 = 35;
const float LIMIAR_FORTE = 1.50f;
#endif

const unsigned long INTERVALO_AMOSTRA = 50;
const unsigned long INTERVALO_TELEMETRIA = 500;
const unsigned long TIMEOUT_WIFI = 15000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;
const float LIMIAR_SOLTO = 0.25f;
const unsigned long DURACAO_MINIMA_PULSO = 20;
const unsigned long DURACAO_MAXIMA_PULSO = 1500;
const unsigned long DEBOUNCE_COMANDO = 200;

static uint8_t MAC_CUSTOM[6] = { 0x02, 0x50, 0x4B, 0x58, 0x00, 0x01 };

volatile bool wifiTentando = false;
volatile bool wifiConectado = false;
bool ntpIniciado = false;
bool socketIniciado = false;
bool socketConectado = false;
bool socketAutenticado = false;
unsigned long inicioTentativaWiFi = 0;
unsigned long ultimaTentativaWiFi = 0;
unsigned long ultimoAvisoNTP = 0;
unsigned long ultimaAmostra = 0;
unsigned long ultimaTelemetria = 0;
uint32_t sessaoDispositivo = 0;
uint32_t sequencia = 0;
float tensoes[2] = { 0.0f, 0.0f };

struct EstadoSensor {
  bool armado = false;
  bool pressionado = false;
  unsigned long inicio = 0;
  unsigned long ultimoComando = 0;
  float pico = 0.0f;
};

EstadoSensor sensores[2];
WebSocketsClient webSocket;

bool configurarMacPersonalizado() {
  Serial.println("[MAC] Configurando endereco personalizado...");
  const esp_err_t base = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_BASE);
  const esp_err_t sta = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_WIFI_STA);
  if (base != ESP_OK || sta != ESP_OK) {
    Serial.printf("[MAC] Falha: base=%s sta=%s\n", esp_err_to_name(base), esp_err_to_name(sta));
    return false;
  }
  uint8_t mac[6] = { 0 };
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) return false;
  Serial.printf("[MAC] %02X:%02X:%02X:%02X:%02X:%02X\n",
    mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return mac[0] || mac[1] || mac[2] || mac[3] || mac[4] || mac[5];
}

void eventoWiFi(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiTentando = false;
      wifiConectado = true;
      Serial.printf("[WiFi] Conectado | IP: %s | RSSI: %d dBm\n",
        WiFi.localIP().toString().c_str(), WiFi.RSSI());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      wifiConectado = false;
      wifiTentando = false;
      socketConectado = false;
      socketAutenticado = false;
      ultimaTentativaWiFi = millis();
      Serial.printf("[WiFi] Desconectado. Motivo: %d\n", info.wifi_sta_disconnected.reason);
      break;
    default:
      break;
  }
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED || wifiTentando) return;
  wifiTentando = true;
  inicioTentativaWiFi = millis();
  ultimaTentativaWiFi = millis();
  Serial.printf("[WiFi] Conectando a %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool gerenciarWiFi() {
  const unsigned long agora = millis();
  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    wifiTentando = false;
    return true;
  }
  wifiConectado = false;
  if (wifiTentando && agora - inicioTentativaWiFi > TIMEOUT_WIFI) {
    WiFi.disconnect(false, false);
    wifiTentando = false;
    ultimaTentativaWiFi = agora;
    Serial.println("[WiFi] Timeout de conexao.");
  } else if (!wifiTentando && agora - ultimaTentativaWiFi >= INTERVALO_RECONEXAO_WIFI) {
    conectarWiFi();
  }
  return false;
}

void autenticarSocket() {
  char pacote[256];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"auth\",\"role\":\"device\",\"teste_id\":\"%s\",\"token\":\"%s\"}",
    TESTE_ID, DEVICE_TOKEN);
  webSocket.sendTXT(pacote);
}

void eventoWebSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      socketConectado = true;
      socketAutenticado = false;
      Serial.println("[WS] Conectado. Autenticando dispositivo...");
      autenticarSocket();
      break;
    case WStype_DISCONNECTED:
      socketConectado = false;
      socketAutenticado = false;
      Serial.println("[WS] Desconectado. Reconexao automatica ativa.");
      break;
    case WStype_TEXT: {
      String mensagem;
      mensagem.reserve(length);
      for (size_t i = 0; i < length; i++) mensagem += char(payload[i]);
      if (mensagem.indexOf("\"type\":\"auth_ok\"") >= 0) {
        socketAutenticado = true;
        Serial.println("[WS] WebSocket autenticado. Controle pronto.");
      } else if (mensagem.indexOf("\"type\":\"persist_error\"") >= 0) {
        Serial.println("[WS] Comando entregue ao jogo, mas nao persistido.");
      }
      break;
    }
    case WStype_ERROR:
      Serial.println("[WS] Erro de transporte.");
      break;
    default:
      break;
  }
}

void iniciarWebSocket() {
  if (socketIniciado) return;
  webSocket.onEvent(eventoWebSocket);
  webSocket.setReconnectInterval(1000);
  webSocket.enableHeartbeat(15000, 3000, 2);
  if (WS_SECURE) webSocket.beginSslWithCA(WS_HOST, WS_PORT, WS_PATH, ROOT_CA, "crossy-v1");
  else webSocket.begin(WS_HOST, WS_PORT, WS_PATH, "crossy-v1");
  socketIniciado = true;
  Serial.printf("[WS] Abrindo %s://%s:%u%s\n", WS_SECURE ? "wss" : "ws", WS_HOST, WS_PORT, WS_PATH);
}

void enviarComando(int player, float pico) {
  if (!socketAutenticado) {
    Serial.printf("[CTRL] Jogador %d ignorado: WebSocket indisponivel.\n", player);
    return;
  }
  if (sequencia >= 2147483647UL) sequencia = 0;
  sequencia++;
  char pacote[180];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"command\",\"player\":%d,\"session\":\"%08lx\",\"sequence\":%lu,\"voltage\":%.3f}",
    player, (unsigned long)sessaoDispositivo, (unsigned long)sequencia, pico);
  if (webSocket.sendTXT(pacote)) {
    Serial.printf("[CTRL] Jogador %d | seq=%lu | pico=%.3f V\n",
      player, (unsigned long)sequencia, pico);
  }
}

void processarSensor(int indice, float tensao, unsigned long agora) {
  EstadoSensor& sensor = sensores[indice];
  if (tensao <= LIMIAR_SOLTO) {
    if (sensor.pressionado) {
      const unsigned long duracao = agora - sensor.inicio;
      if (duracao >= DURACAO_MINIMA_PULSO && duracao <= DURACAO_MAXIMA_PULSO &&
          agora - sensor.ultimoComando >= DEBOUNCE_COMANDO) {
        sensor.ultimoComando = agora;
        enviarComando(indice + 1, sensor.pico);
      }
    }
    sensor.armado = true;
    sensor.pressionado = false;
    sensor.pico = 0.0f;
  } else if (sensor.armado && !sensor.pressionado && tensao >= LIMIAR_FORTE) {
    sensor.armado = false;
    sensor.pressionado = true;
    sensor.inicio = agora;
    sensor.pico = tensao;
  } else if (sensor.pressionado && tensao > sensor.pico) {
    sensor.pico = tensao;
  }
}

void amostrarSensores() {
  const int pinos[2] = { PINO_ADC_PLAYER_1, PINO_ADC_PLAYER_2 };
  const unsigned long agora = millis();
  for (int indice = 0; indice < 2; indice++) {
    const int leitura = analogRead(pinos[indice]);
    tensoes[indice] = float(leitura) * (3.3f / 4095.0f);
    processarSensor(indice, tensoes[indice], agora);
  }
}

void enviarTelemetria() {
  if (!socketAutenticado) return;
  char pacote[110];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"telemetry\",\"voltages\":[%.3f,%.3f]}", tensoes[0], tensoes[1]);
  webSocket.sendTXT(pacote);
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n==============================");
  Serial.println("ESP32 CROSSY ROAD | WEBSOCKET");
  Serial.println("==============================");

  if (!configurarMacPersonalizado()) {
    Serial.println("FALHA CRITICA: MAC nao foi configurado.");
    while (true) delay(1000);
  }

  pinMode(PINO_ADC_PLAYER_1, INPUT);
  pinMode(PINO_ADC_PLAYER_2, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ADC_PLAYER_1, ADC_11db);
  analogSetPinAttenuation(PINO_ADC_PLAYER_2, ADC_11db);

  timeval horarioZerado = { 0, 0 };
  settimeofday(&horarioZerado, nullptr);
  sessaoDispositivo = esp_random();
  if (sessaoDispositivo == 0) sessaoDispositivo = 1;

  WiFi.onEvent(eventoWiFi);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  conectarWiFi();
}

void loop() {
  const unsigned long agora = millis();
  if (!gerenciarWiFi()) {
    delay(5);
    return;
  }

  if (!ntpIniciado) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpIniciado = true;
    Serial.println("[NTP] Sincronizando horario...");
  }
  if (time(nullptr) < 1700000000) {
    if (agora - ultimoAvisoNTP >= 2000) {
      ultimoAvisoNTP = agora;
      Serial.println("[NTP] Aguardando horario...");
    }
    delay(5);
    return;
  }

  iniciarWebSocket();
  webSocket.loop();

  if (agora - ultimaAmostra >= INTERVALO_AMOSTRA) {
    ultimaAmostra = agora;
    amostrarSensores();
  }
  if (agora - ultimaTelemetria >= INTERVALO_TELEMETRIA) {
    ultimaTelemetria = agora;
    enviarTelemetria();
  }
  delay(1);
}
