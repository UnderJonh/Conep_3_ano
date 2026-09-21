/*
 * Firmware ESP32 - Crossy Road via WebSocket (versao instrumentada)
 *
 * A placa detecta cada pisada localmente e envia somente o comando pronto.
 * A conexao WebSocket permanece aberta, evitando handshakes HTTPS repetidos.
 *
 * Esta versao registra no Serial (115200) cada etapa do caminho:
 * boot -> WiFi -> DNS -> NTP -> TLS -> handshake HTTP -> WebSocket -> sensores.
 * Antes de abrir o WebSocket o firmware executa um diagnostico que imprime a
 * resposta HTTP crua do servidor, revelando exatamente por que o upgrade falha.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>
#include <time.h>
#include <sys/time.h>
#include <stdarg.h>
#include <string.h>
#include <esp_mac.h>
#include <esp_err.h>
#include <esp_system.h>
#include <esp_log.h>

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

// ---------------------------------------------------------------------------
// Chaves de log. Deixe em 1 para ver tudo; baixe para 0 se o Serial encher.
// ---------------------------------------------------------------------------
#define LOG_VERBOSO        1  // detalhes de rede, pacotes enviados e sensores
#define LOG_ADC_PERIODICO  1  // tensao de repouso a cada INTERVALO_LOG_ADC
#define LOG_ADC_BRUTO      0  // cada amostra do ADC (20 Hz por canal, ruidoso)
#define LOG_HEX_RX         0  // dump hexadecimal de tudo que chega
#define LOG_DIAGNOSTICO    1  // sonda o handshake HTTP antes de abrir o socket

const char* const WS_SUBPROTOCOLO = "crossy-v1";

const unsigned long INTERVALO_AMOSTRA = 50;
const unsigned long INTERVALO_TELEMETRIA = 500;
const unsigned long TIMEOUT_WIFI = 15000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;
const unsigned long INTERVALO_LOG_ESTADO = 5000;
const unsigned long INTERVALO_LOG_ADC = 1000;
const unsigned long INTERVALO_DIAGNOSTICO = 60000;
const unsigned long QUEDAS_ATE_REDIAGNOSTICAR = 5;
const float LIMIAR_SOLTO = 0.25f;
const unsigned long REARME_FORCADO = 4000;
const unsigned long DEBOUNCE_COMANDO = 200;

static uint8_t MAC_CUSTOM[6] = { 0x02, 0x50, 0x4B, 0x58, 0x00, 0x01 };

volatile bool wifiTentando = false;
volatile bool wifiConectado = false;
bool ntpIniciado = false;
bool ntpPronto = false;
bool redeJaRegistrada = false;
bool socketIniciado = false;
bool socketConectado = false;
bool socketAutenticado = false;
unsigned long inicioTentativaWiFi = 0;
unsigned long ultimaTentativaWiFi = 0;
unsigned long ultimoAvisoNTP = 0;
unsigned long inicioNTP = 0;
unsigned long ultimaAmostra = 0;
unsigned long ultimaTelemetria = 0;
unsigned long ultimoLogEstado = 0;
unsigned long ultimoLogADC = 0;
unsigned long ultimoDiagnostico = 0;
unsigned long inicioConexaoSocket = 0;
unsigned long quedasDesdeDiagnostico = 0;
uint32_t sessaoDispositivo = 0;
uint32_t sequencia = 0;
float tensoes[2] = { 0.0f, 0.0f };
int brutos[2] = { 0, 0 };

struct EstadoSensor {
  bool armado = false;
  bool pressionado = false;
  unsigned long inicio = 0;
  unsigned long ultimoComando = 0;
  float pico = 0.0f;
  int picoBruto = 0;
};

struct Estatisticas {
  uint32_t wifiConexoes = 0;
  uint32_t wifiQuedas = 0;
  uint32_t wsConexoes = 0;
  uint32_t wsQuedas = 0;
  uint32_t wsErros = 0;
  uint32_t enviados = 0;
  uint32_t falhasEnvio = 0;
  uint32_t recebidos = 0;
  uint32_t comandos[2] = { 0, 0 };
  uint32_t descartados = 0;
  unsigned long tempoTotalConectado = 0;
};

EstadoSensor sensores[2];
Estatisticas stats;
WebSocketsClient webSocket;

// ---------------------------------------------------------------------------
// Infraestrutura de log
// ---------------------------------------------------------------------------

void logSerial(const char* tag, const char* formato, ...) {
  char mensagem[320];
  va_list args;
  va_start(args, formato);
  vsnprintf(mensagem, sizeof(mensagem), formato, args);
  va_end(args);
  const unsigned long ms = millis();
  Serial.printf("[%5lu.%03lus|heap %6u][%-5s] %s\n",
    ms / 1000UL, ms % 1000UL, (unsigned)ESP.getFreeHeap(), tag, mensagem);
}

#define LOGV(...) do { if (LOG_VERBOSO) logSerial(__VA_ARGS__); } while (0)

void logSeparador(const char* titulo) {
  Serial.println();
  Serial.println("==================================================");
  Serial.printf("  %s\n", titulo);
  Serial.println("==================================================");
}

const char* nomeMotivoReset(esp_reset_reason_t motivo) {
  switch (motivo) {
    case ESP_RST_POWERON: return "energia ligada";
    case ESP_RST_EXT: return "reset externo";
    case ESP_RST_SW: return "reset por software";
    case ESP_RST_PANIC: return "panico / excecao";
    case ESP_RST_INT_WDT: return "watchdog de interrupcao";
    case ESP_RST_TASK_WDT: return "watchdog de tarefa";
    case ESP_RST_WDT: return "outro watchdog";
    case ESP_RST_DEEPSLEEP: return "saida de deep sleep";
    case ESP_RST_BROWNOUT: return "brownout (queda de tensao)";
    case ESP_RST_SDIO: return "reset via SDIO";
    default: return "desconhecido";
  }
}

const char* nomeStatusWiFi(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "ocioso";
    case WL_NO_SSID_AVAIL: return "SSID nao encontrado";
    case WL_SCAN_COMPLETED: return "varredura concluida";
    case WL_CONNECTED: return "conectado";
    case WL_CONNECT_FAILED: return "falha de conexao";
    case WL_CONNECTION_LOST: return "conexao perdida";
    case WL_DISCONNECTED: return "desconectado";
    case WL_NO_SHIELD: return "radio indisponivel";
    default: return "desconhecido";
  }
}

const char* nomeMotivoDesconexaoWiFi(uint8_t motivo) {
  switch (motivo) {
    case 1: return "nao especificado";
    case 2: return "autenticacao expirou";
    case 4: return "inatividade";
    case 5: return "AP sem capacidade (muitos clientes)";
    case 8: return "estacao saiu da rede";
    case 15: return "handshake de 4 vias expirou (senha errada)";
    case 200: return "senha incorreta";
    case 201: return "AP nao encontrado";
    case 202: return "falha de autenticacao";
    case 203: return "falha de associacao";
    case 204: return "handshake expirou";
    case 205: return "conexao falhou";
    default: return "consulte wifi_err_reason_t";
  }
}

const char* nomeEventoWS(WStype_t tipo) {
  switch (tipo) {
    case WStype_ERROR: return "ERRO";
    case WStype_DISCONNECTED: return "DESCONECTADO";
    case WStype_CONNECTED: return "CONECTADO";
    case WStype_TEXT: return "TEXTO";
    case WStype_BIN: return "BINARIO";
    case WStype_FRAGMENT_TEXT_START: return "FRAGMENTO TEXTO";
    case WStype_FRAGMENT_BIN_START: return "FRAGMENTO BINARIO";
    case WStype_FRAGMENT: return "FRAGMENTO";
    case WStype_FRAGMENT_FIN: return "FIM DO FRAGMENTO";
    case WStype_PING: return "PING";
    case WStype_PONG: return "PONG";
    default: return "OUTRO";
  }
}

void logDumpHex(const char* tag, const uint8_t* dados, size_t tamanho) {
  char linha[80];
  for (size_t bloco = 0; bloco < tamanho; bloco += 16) {
    int escrito = 0;
    for (size_t i = bloco; i < bloco + 16 && i < tamanho; i++) {
      escrito += snprintf(linha + escrito, sizeof(linha) - escrito, "%02X ", dados[i]);
    }
    logSerial(tag, "  %04u | %s", (unsigned)bloco, linha);
  }
}

// ---------------------------------------------------------------------------
// Log do hardware e da configuracao
// ---------------------------------------------------------------------------

void logInfoChip() {
  logSerial("BOOT", "Chip %s rev %u | %u nucleo(s) | CPU %u MHz",
    ESP.getChipModel(), (unsigned)ESP.getChipRevision(),
    (unsigned)ESP.getChipCores(), (unsigned)getCpuFrequencyMhz());
  logSerial("BOOT", "Flash %u KB a %u MHz | SDK %s",
    (unsigned)(ESP.getFlashChipSize() / 1024),
    (unsigned)(ESP.getFlashChipSpeed() / 1000000), ESP.getSdkVersion());
  logSerial("BOOT", "Heap livre %u B | maior bloco %u B | PSRAM %u B",
    (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(),
    (unsigned)ESP.getPsramSize());
  logSerial("BOOT", "Sketch %u B em particao com %u B livres",
    (unsigned)ESP.getSketchSize(), (unsigned)ESP.getFreeSketchSpace());
  const esp_reset_reason_t motivo = esp_reset_reason();
  logSerial("BOOT", "Motivo do ultimo reset: %s (%d)", nomeMotivoReset(motivo), (int)motivo);
}

void logConfiguracao() {
  const size_t tamanhoToken = strlen(DEVICE_TOKEN);
  const size_t tamanhoTeste = strlen(TESTE_ID);
  logSerial("CFG", "SSID \"%s\" | senha %s",
    WIFI_SSID, strlen(WIFI_PASSWORD) > 0 ? "definida" : "(rede aberta)");
  logSerial("CFG", "Destino %s://%s:%u%s | subprotocolo \"%s\"",
    WS_SECURE ? "wss" : "ws", WS_HOST, WS_PORT, WS_PATH, WS_SUBPROTOCOLO);
  logSerial("CFG", "TESTE_ID %s (%u chars)", TESTE_ID, (unsigned)tamanhoTeste);
  if (tamanhoToken >= 10) {
    logSerial("CFG", "DEVICE_TOKEN %.6s...%s (%u chars)",
      DEVICE_TOKEN, DEVICE_TOKEN + tamanhoToken - 4, (unsigned)tamanhoToken);
  } else {
    logSerial("CFG", "DEVICE_TOKEN suspeito: apenas %u chars", (unsigned)tamanhoToken);
  }
  logSerial("CFG", "ADC J1=GPIO%d J2=GPIO%d | limiar forte %.2f V | limiar solto %.2f V",
    PINO_ADC_PLAYER_1, PINO_ADC_PLAYER_2, LIMIAR_FORTE, LIMIAR_SOLTO);
  logSerial("CFG", "Comando na subida | debounce %lu ms | rearme forcado apos %lu ms",
    DEBOUNCE_COMANDO, REARME_FORCADO);
  logSerial("CFG", "Amostragem %lu ms | telemetria %lu ms", INTERVALO_AMOSTRA, INTERVALO_TELEMETRIA);
  logSerial("CFG", "Pacote de certificados: %u bytes", (unsigned)strlen(ROOT_CA));

  if (tamanhoTeste != 36) {
    logSerial("CFG", "AVISO: o servidor exige UUID de 36 caracteres; este tem %u.",
      (unsigned)tamanhoTeste);
  }
  if (tamanhoToken != 64) {
    logSerial("CFG", "AVISO: o servidor exige token hex de 64 caracteres; este tem %u.",
      (unsigned)tamanhoToken);
  } else {
    bool hexValido = true;
    for (size_t i = 0; i < tamanhoToken; i++) {
      const char c = DEVICE_TOKEN[i];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) { hexValido = false; break; }
    }
    if (!hexValido) logSerial("CFG", "AVISO: o token precisa ser hexadecimal minusculo.");
  }
}

void logRedeDetalhada() {
  logSerial("WIFI", "IP %s | mascara %s | gateway %s",
    WiFi.localIP().toString().c_str(), WiFi.subnetMask().toString().c_str(),
    WiFi.gatewayIP().toString().c_str());
  logSerial("WIFI", "DNS1 %s | DNS2 %s",
    WiFi.dnsIP(0).toString().c_str(), WiFi.dnsIP(1).toString().c_str());
  logSerial("WIFI", "BSSID %s | canal %d | RSSI %d dBm",
    WiFi.BSSIDstr().c_str(), WiFi.channel(), WiFi.RSSI());
  logSerial("WIFI", "MAC da estacao %s | hostname %s",
    WiFi.macAddress().c_str(), WiFi.getHostname());
}

void logResolucaoDNS() {
  IPAddress endereco;
  const unsigned long inicio = millis();
  const bool ok = WiFi.hostByName(WS_HOST, endereco);
  const unsigned long duracao = millis() - inicio;
  if (ok) logSerial("DNS", "%s -> %s em %lu ms", WS_HOST, endereco.toString().c_str(), duracao);
  else logSerial("DNS", "FALHA ao resolver %s apos %lu ms", WS_HOST, duracao);
}

// ---------------------------------------------------------------------------
// Sonda de handshake: mostra a resposta HTTP crua do servidor
// ---------------------------------------------------------------------------

void interpretarStatusHandshake(int codigo) {
  switch (codigo) {
    case 101:
      logSerial("DIAG", "OK: o servidor aceitou o upgrade para WebSocket.");
      break;
    case 200:
      logSerial("DIAG", "PROBLEMA: veio 200 com a pagina do site, e nao 101.");
      logSerial("DIAG", "  Os cabecalhos Upgrade/Connection sumiram no caminho ate a origem.");
      logSerial("DIAG", "  Quase sempre e o proxy/CDN na frente do servidor (por exemplo");
      logSerial("DIAG", "  Cloudflare com WebSockets desligado). Ligue WebSockets no painel");
      logSerial("DIAG", "  ou aponte o DNS direto para a origem.");
      break;
    case 301: case 302: case 307: case 308:
      logSerial("DIAG", "PROBLEMA: redirecionamento. Aponte WS_HOST/WS_PATH ao destino final.");
      break;
    case 400:
      logSerial("DIAG", "PROBLEMA: requisicao recusada. Confira WS_PATH e o subprotocolo.");
      break;
    case 404:
      logSerial("DIAG", "PROBLEMA: o caminho %s nao existe no servidor.", WS_PATH);
      break;
    case 426:
      logSerial("DIAG", "PROBLEMA: o servidor exige um upgrade diferente do enviado.");
      break;
    case 429:
      logSerial("DIAG", "PROBLEMA: limite de requisicoes atingido.");
      break;
    case 502: case 503: case 504:
      logSerial("DIAG", "PROBLEMA: origem fora do ar ou reiniciando.");
      break;
    default:
      logSerial("DIAG", "Status inesperado %d. Veja os cabecalhos acima.", codigo);
      break;
  }
}

void diagnosticoHandshake() {
  logSeparador("DIAGNOSTICO DO HANDSHAKE");
  logResolucaoDNS();

  WiFiClientSecure cliente;
  if (WS_SECURE) cliente.setCACert(ROOT_CA);
  else cliente.setInsecure();
  cliente.setTimeout(8);
  cliente.setHandshakeTimeout(15);

  logSerial("DIAG", "Abrindo TCP/TLS com %s:%u...", WS_HOST, WS_PORT);
  const unsigned long inicio = millis();
  if (!cliente.connect(WS_HOST, WS_PORT)) {
    char erro[128] = { 0 };
    const int codigo = cliente.lastError(erro, sizeof(erro));
    logSerial("DIAG", "FALHA na conexao apos %lu ms | erro %d: %s",
      millis() - inicio, codigo, erro);
    logSerial("DIAG", "  Erro de certificado: atualize certificados.h com a raiz do host.");
    logSerial("DIAG", "  Timeout: cheque firewall, DNS ou o relogio (NTP) da placa.");
    cliente.stop();
    return;
  }
  logSerial("DIAG", "Conexao estabelecida em %lu ms.", millis() - inicio);

  char requisicao[512];
  snprintf(requisicao, sizeof(requisicao),
    "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    "Sec-WebSocket-Key: ZGlhZ25vc3RpY28xMjM0NQ==\r\nSec-WebSocket-Version: 13\r\n"
    "Sec-WebSocket-Protocol: %s\r\nUser-Agent: ESP32-CrossyRoad\r\n\r\n",
    WS_PATH, WS_HOST, WS_SUBPROTOCOLO);
  logSerial("DIAG", "Enviando handshake de %u bytes:", (unsigned)strlen(requisicao));
  logSerial("DIAG", "  >> GET %s HTTP/1.1", WS_PATH);
  logSerial("DIAG", "  >> Host: %s", WS_HOST);
  logSerial("DIAG", "  >> Upgrade: websocket");
  logSerial("DIAG", "  >> Connection: Upgrade");
  logSerial("DIAG", "  >> Sec-WebSocket-Version: 13");
  logSerial("DIAG", "  >> Sec-WebSocket-Protocol: %s", WS_SUBPROTOCOLO);
  cliente.print(requisicao);

  const unsigned long limite = millis() + 10000;
  bool primeiraLinha = true;
  int codigoStatus = 0;
  unsigned linhasLidas = 0;
  while (cliente.connected() && millis() < limite) {
    if (!cliente.available()) { delay(10); continue; }
    String linha = cliente.readStringUntil('\n');
    linha.trim();
    if (primeiraLinha) {
      primeiraLinha = false;
      logSerial("DIAG", "  << %s", linha.c_str());
      const int espaco = linha.indexOf(' ');
      if (espaco > 0) codigoStatus = linha.substring(espaco + 1).toInt();
      continue;
    }
    if (linha.length() == 0) break;
    logSerial("DIAG", "  << %s", linha.c_str());
    if (++linhasLidas > 40) break;
  }

  if (primeiraLinha) logSerial("DIAG", "FALHA: o servidor nao respondeu em 10 s.");
  else interpretarStatusHandshake(codigoStatus);

  cliente.stop();
  logSerial("DIAG", "Diagnostico concluido.");
  Serial.println("==================================================");
  Serial.println();
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

bool configurarMacPersonalizado() {
  logSerial("MAC", "Configurando endereco personalizado...");
  const esp_err_t base = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_BASE);
  const esp_err_t sta = esp_iface_mac_addr_set(MAC_CUSTOM, ESP_MAC_WIFI_STA);
  if (base != ESP_OK || sta != ESP_OK) {
    logSerial("MAC", "Falha: base=%s sta=%s", esp_err_to_name(base), esp_err_to_name(sta));
    return false;
  }
  uint8_t mac[6] = { 0 };
  const esp_err_t leitura = esp_read_mac(mac, ESP_MAC_WIFI_STA);
  if (leitura != ESP_OK) {
    logSerial("MAC", "Falha ao reler o MAC: %s", esp_err_to_name(leitura));
    return false;
  }
  logSerial("MAC", "Ativo: %02X:%02X:%02X:%02X:%02X:%02X",
    mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return mac[0] || mac[1] || mac[2] || mac[3] || mac[4] || mac[5];
}

void eventoWiFi(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      logSerial("WIFI", "Evento: interface iniciada.");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      logSerial("WIFI", "Evento: associado ao AP | canal %u",
        (unsigned)info.wifi_sta_connected.channel);
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiTentando = false;
      wifiConectado = true;
      redeJaRegistrada = false;
      stats.wifiConexoes++;
      logSerial("WIFI", "Evento: IP recebido em %lu ms.", millis() - inicioTentativaWiFi);
      break;
    case ARDUINO_EVENT_WIFI_STA_LOST_IP:
      logSerial("WIFI", "Evento: IP perdido.");
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      const uint8_t motivo = info.wifi_sta_disconnected.reason;
      wifiConectado = false;
      wifiTentando = false;
      socketConectado = false;
      socketAutenticado = false;
      stats.wifiQuedas++;
      ultimaTentativaWiFi = millis();
      logSerial("WIFI", "Evento: desconectado | motivo %u (%s) | queda numero %lu",
        (unsigned)motivo, nomeMotivoDesconexaoWiFi(motivo), (unsigned long)stats.wifiQuedas);
      break;
    }
    default:
      LOGV("WIFI", "Evento nao tratado: %d", (int)event);
      break;
  }
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED || wifiTentando) return;
  wifiTentando = true;
  inicioTentativaWiFi = millis();
  ultimaTentativaWiFi = millis();
  logSerial("WIFI", "Conectando a \"%s\"...", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool gerenciarWiFi() {
  const unsigned long agora = millis();
  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    wifiTentando = false;
    if (!redeJaRegistrada) {
      redeJaRegistrada = true;
      logRedeDetalhada();
    }
    return true;
  }
  wifiConectado = false;
  if (wifiTentando && agora - inicioTentativaWiFi > TIMEOUT_WIFI) {
    logSerial("WIFI", "Timeout apos %lu ms | status atual: %s",
      agora - inicioTentativaWiFi, nomeStatusWiFi(WiFi.status()));
    WiFi.disconnect(false, false);
    wifiTentando = false;
    ultimaTentativaWiFi = agora;
  } else if (!wifiTentando && agora - ultimaTentativaWiFi >= INTERVALO_RECONEXAO_WIFI) {
    conectarWiFi();
  }
  return false;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

void autenticarSocket() {
  char pacote[256];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"auth\",\"role\":\"device\",\"teste_id\":\"%s\",\"token\":\"%s\"}",
    TESTE_ID, DEVICE_TOKEN);
  const bool ok = webSocket.sendTXT(pacote);
  logSerial("AUTH", "Enviando credenciais (%u bytes): %s",
    (unsigned)strlen(pacote), ok ? "pacote enfileirado" : "FALHA no envio!");
  LOGV("AUTH", "  payload: {\"type\":\"auth\",\"role\":\"device\",\"teste_id\":\"%s\",\"token\":\"***\"}",
    TESTE_ID);
  if (!ok) stats.falhasEnvio++;
}

void eventoWebSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      socketConectado = true;
      socketAutenticado = false;
      stats.wsConexoes++;
      quedasDesdeDiagnostico = 0;
      inicioConexaoSocket = millis();
      logSerial("WS", "Conectado (conexao numero %lu) | caminho: %s",
        (unsigned long)stats.wsConexoes, payload ? (const char*)payload : WS_PATH);
      autenticarSocket();
      break;

    case WStype_DISCONNECTED: {
      const bool estavaConectado = socketConectado;
      socketConectado = false;
      socketAutenticado = false;
      stats.wsQuedas++;
      quedasDesdeDiagnostico++;
      if (estavaConectado && inicioConexaoSocket) {
        const unsigned long duracao = millis() - inicioConexaoSocket;
        stats.tempoTotalConectado += duracao;
        logSerial("WS", "Desconectado apos %lu ms conectado | queda numero %lu",
          duracao, (unsigned long)stats.wsQuedas);
      } else {
        logSerial("WS", "Nao conseguiu abrir a conexao | tentativa numero %lu",
          (unsigned long)stats.wsQuedas);
        logSerial("WS", "  Nenhum evento CONECTADO antes desta queda: o handshake foi recusado.");
      }
      inicioConexaoSocket = 0;
      break;
    }

    case WStype_TEXT: {
      stats.recebidos++;
      String mensagem;
      mensagem.reserve(length + 1);
      for (size_t i = 0; i < length; i++) mensagem += char(payload[i]);
      logSerial("RX", "Texto (%u bytes): %s", (unsigned)length, mensagem.c_str());
      if (LOG_HEX_RX) logDumpHex("RX", payload, length);

      if (mensagem.indexOf("\"type\":\"auth_ok\"") >= 0) {
        socketAutenticado = true;
        logSerial("AUTH", "Autenticado. Controle liberado apos %lu ms de conexao.",
          inicioConexaoSocket ? millis() - inicioConexaoSocket : 0UL);
      } else if (mensagem.indexOf("\"type\":\"ack\"") >= 0) {
        LOGV("RX", "  confirmacao de comando recebida.");
      } else if (mensagem.indexOf("\"type\":\"persist_error\"") >= 0) {
        logSerial("RX", "  comando entregue ao jogo, mas nao gravado no banco.");
      } else {
        LOGV("RX", "  mensagem sem tratamento especifico.");
      }
      break;
    }

    case WStype_BIN:
      stats.recebidos++;
      logSerial("RX", "Binario (%u bytes).", (unsigned)length);
      logDumpHex("RX", payload, length);
      break;

    case WStype_PING:
      LOGV("WS", "Ping recebido (%u bytes).", (unsigned)length);
      break;

    case WStype_PONG:
      LOGV("WS", "Pong recebido (%u bytes).", (unsigned)length);
      break;

    case WStype_ERROR:
      stats.wsErros++;
      logSerial("WS", "Erro de transporte numero %lu: %.*s",
        (unsigned long)stats.wsErros, (int)length, payload ? (const char*)payload : "");
      break;

    default:
      logSerial("WS", "Evento %s (%d) com %u bytes.",
        nomeEventoWS(type), (int)type, (unsigned)length);
      break;
  }
}

void iniciarWebSocket() {
  if (socketIniciado) return;
  webSocket.onEvent(eventoWebSocket);
  webSocket.setReconnectInterval(1000);
  webSocket.enableHeartbeat(15000, 3000, 2);
  if (WS_SECURE) webSocket.beginSslWithCA(WS_HOST, WS_PORT, WS_PATH, ROOT_CA, WS_SUBPROTOCOLO);
  else webSocket.begin(WS_HOST, WS_PORT, WS_PATH, WS_SUBPROTOCOLO);
  socketIniciado = true;
  logSerial("WS", "Abrindo %s://%s:%u%s | reconexao a cada 1000 ms | heartbeat 15 s",
    WS_SECURE ? "wss" : "ws", WS_HOST, WS_PORT, WS_PATH);
}

void enviarComando(int player, float pico, int picoBruto, unsigned long duracao) {
  (void)duracao;
  if (!socketAutenticado) {
    logSerial("CTRL", "Jogador %d ignorado: %s",
      player, socketConectado ? "WebSocket ainda nao autenticado" : "WebSocket desconectado");
    stats.descartados++;
    return;
  }
  if (sequencia >= 2147483647UL) {
    logSerial("CTRL", "Sequencia no limite; reiniciando a contagem.");
    sequencia = 0;
  }
  sequencia++;
  char pacote[180];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"command\",\"player\":%d,\"session\":\"%08lx\",\"sequence\":%lu,\"voltage\":%.3f}",
    player, (unsigned long)sessaoDispositivo, (unsigned long)sequencia, pico);
  const bool ok = webSocket.sendTXT(pacote);
  if (ok) {
    stats.enviados++;
    stats.comandos[player - 1]++;
    logSerial("CTRL", "Jogador %d | seq %lu | disparo em %.3f V (bruto %d)",
      player, (unsigned long)sequencia, pico, picoBruto);
    LOGV("TX", "  %s", pacote);
  } else {
    stats.falhasEnvio++;
    logSerial("CTRL", "Jogador %d | seq %lu | FALHA ao enfileirar o pacote.",
      player, (unsigned long)sequencia);
  }
}

// ---------------------------------------------------------------------------
// Sensores
// ---------------------------------------------------------------------------

void processarSensor(int indice, float tensao, int bruto, unsigned long agora) {
  EstadoSensor& sensor = sensores[indice];
  const int player = indice + 1;

  if (tensao <= LIMIAR_SOLTO) {
    if (sensor.pressionado) {
      logSerial("ADC", "J%d solto apos %lu ms | pico %.3f V (bruto %d)",
        player, agora - sensor.inicio, sensor.pico, sensor.picoBruto);
    }
    if (!sensor.armado) LOGV("ADC", "J%d rearmado em %.3f V.", player, tensao);
    sensor.armado = true;
    sensor.pressionado = false;
    sensor.pico = 0.0f;
    sensor.picoBruto = 0;
    return;
  }

  // O sensor demora a descarregar. Se ficar preso acima de LIMIAR_SOLTO por
  // tempo demais, rearma na forca para nao travar o jogador.
  if (sensor.pressionado && agora - sensor.inicio > REARME_FORCADO) {
    logSerial("ADC", "J%d preso em %.3f V ha %lu ms | rearmando na forca",
      player, tensao, agora - sensor.inicio);
    sensor.armado = true;
    sensor.pressionado = false;
    sensor.pico = 0.0f;
    sensor.picoBruto = 0;
    return;
  }

  if (sensor.armado && !sensor.pressionado && tensao >= LIMIAR_FORTE) {
    sensor.armado = false;
    sensor.pressionado = true;
    sensor.inicio = agora;
    sensor.pico = tensao;
    sensor.picoBruto = bruto;
    const unsigned long desdeUltimo = agora - sensor.ultimoComando;
    logSerial("ADC", "J%d pressionado a %.3f V (bruto %d) | limiar %.2f V",
      player, tensao, bruto, LIMIAR_FORTE);
    if (desdeUltimo < DEBOUNCE_COMANDO) {
      stats.descartados++;
      logSerial("ADC", "J%d descartado: debounce (%lu de %lu ms)",
        player, desdeUltimo, DEBOUNCE_COMANDO);
    } else {
      sensor.ultimoComando = agora;
      enviarComando(player, tensao, bruto, 0);
    }
  } else if (sensor.pressionado && tensao > sensor.pico) {
    sensor.pico = tensao;
    sensor.picoBruto = bruto;
    LOGV("ADC", "J%d novo pico %.3f V (bruto %d).", player, tensao, bruto);
  } else if (!sensor.armado && !sensor.pressionado) {
    LOGV("ADC", "J%d em %.3f V: aguardando cair abaixo de %.2f V para rearmar.",
      player, tensao, LIMIAR_SOLTO);
  }
}

void amostrarSensores() {
  const int pinos[2] = { PINO_ADC_PLAYER_1, PINO_ADC_PLAYER_2 };
  const unsigned long agora = millis();
  for (int indice = 0; indice < 2; indice++) {
    brutos[indice] = analogRead(pinos[indice]);
    tensoes[indice] = float(brutos[indice]) * (3.3f / 4095.0f);
    if (LOG_ADC_BRUTO) {
      logSerial("ADC", "J%d bruto %4d -> %.3f V", indice + 1, brutos[indice], tensoes[indice]);
    }
    processarSensor(indice, tensoes[indice], brutos[indice], agora);
  }
}

void enviarTelemetria() {
  if (!socketAutenticado) {
    LOGV("TX", "Telemetria adiada: WebSocket nao autenticado.");
    return;
  }
  char pacote[110];
  snprintf(pacote, sizeof(pacote),
    "{\"type\":\"telemetry\",\"voltages\":[%.3f,%.3f]}", tensoes[0], tensoes[1]);
  const bool ok = webSocket.sendTXT(pacote);
  if (ok) {
    stats.enviados++;
    LOGV("TX", "Telemetria: %s", pacote);
  } else {
    stats.falhasEnvio++;
    logSerial("TX", "FALHA ao enviar telemetria.");
  }
}

void logEstadoPeriodico() {
  const char* estadoSocket = socketAutenticado ? "autenticado"
    : socketConectado ? "conectado (sem auth)"
    : socketIniciado ? "tentando conectar" : "parado";
  logSerial("STAT", "WiFi %s (RSSI %d dBm) | WebSocket %s | NTP %s",
    wifiConectado ? "conectado" : nomeStatusWiFi(WiFi.status()),
    wifiConectado ? WiFi.RSSI() : 0, estadoSocket, ntpPronto ? "sincronizado" : "pendente");
  logSerial("STAT", "Tensoes: J1 %.3f V (bruto %d) | J2 %.3f V (bruto %d)",
    tensoes[0], brutos[0], tensoes[1], brutos[1]);
  logSerial("STAT", "Comandos J1 %lu | J2 %lu | descartados %lu | sequencia %lu",
    (unsigned long)stats.comandos[0], (unsigned long)stats.comandos[1],
    (unsigned long)stats.descartados, (unsigned long)sequencia);
  logSerial("STAT", "Pacotes enviados %lu (falhas %lu) | recebidos %lu",
    (unsigned long)stats.enviados, (unsigned long)stats.falhasEnvio,
    (unsigned long)stats.recebidos);
  logSerial("STAT", "Quedas WiFi %lu | conexoes WS %lu | quedas WS %lu | erros WS %lu",
    (unsigned long)stats.wifiQuedas, (unsigned long)stats.wsConexoes,
    (unsigned long)stats.wsQuedas, (unsigned long)stats.wsErros);
  logSerial("STAT", "Tempo total com WebSocket aberto: %lu s",
    (stats.tempoTotalConectado + (inicioConexaoSocket ? millis() - inicioConexaoSocket : 0UL)) / 1000UL);
  logSerial("STAT", "Heap livre %u B | maior bloco %u B | uptime %lu s",
    (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(), millis() / 1000UL);
}

void logTensaoRepouso() {
  logSerial("ADC", "Repouso: J1 %.3f V (bruto %d) | J2 %.3f V (bruto %d)",
    tensoes[0], brutos[0], tensoes[1], brutos[1]);
}

// ---------------------------------------------------------------------------
// setup / loop
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(800);
  logSeparador("ESP32 CROSSY ROAD | WEBSOCKET | LOG COMPLETO");
  // Para ver tambem os logs internos do core, suba o "Core Debug Level" na IDE.
  esp_log_level_set("*", ESP_LOG_INFO);

  logInfoChip();
  logConfiguracao();

  if (!configurarMacPersonalizado()) {
    logSerial("BOOT", "FALHA CRITICA: MAC nao configurado. Execucao interrompida.");
    while (true) delay(1000);
  }

  pinMode(PINO_ADC_PLAYER_1, INPUT);
  pinMode(PINO_ADC_PLAYER_2, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PINO_ADC_PLAYER_1, ADC_11db);
  analogSetPinAttenuation(PINO_ADC_PLAYER_2, ADC_11db);
  logSerial("BOOT", "ADC pronto: 12 bits, atenuacao 11 dB (faixa util ~0 a 3.1 V).");

  timeval horarioZerado = { 0, 0 };
  settimeofday(&horarioZerado, nullptr);
  sessaoDispositivo = esp_random();
  if (sessaoDispositivo == 0) sessaoDispositivo = 1;
  logSerial("BOOT", "Sessao do dispositivo: %08lx", (unsigned long)sessaoDispositivo);

  WiFi.onEvent(eventoWiFi);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  logSerial("BOOT", "Modo estacao ativo. Iniciando conexao.");
  conectarWiFi();
}

void loop() {
  const unsigned long agora = millis();

  if (agora - ultimoLogEstado >= INTERVALO_LOG_ESTADO) {
    ultimoLogEstado = agora;
    logEstadoPeriodico();
  }

  if (!gerenciarWiFi()) {
    delay(5);
    return;
  }

  if (!ntpIniciado) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpIniciado = true;
    inicioNTP = agora;
    logSerial("NTP", "Sincronizando com pool.ntp.org e time.google.com...");
  }
  if (time(nullptr) < 1700000000) {
    if (agora - ultimoAvisoNTP >= 2000) {
      ultimoAvisoNTP = agora;
      logSerial("NTP", "Aguardando horario valido ha %lu ms...", agora - inicioNTP);
    }
    delay(5);
    return;
  }
  if (!ntpPronto) {
    ntpPronto = true;
    const time_t agoraUTC = time(nullptr);
    char formatado[32];
    strftime(formatado, sizeof(formatado), "%Y-%m-%d %H:%M:%S", gmtime(&agoraUTC));
    logSerial("NTP", "Horario sincronizado em %lu ms: %s UTC", agora - inicioNTP, formatado);
    logSerial("NTP", "Relogio valido: o certificado TLS ja pode ser verificado.");
  }

  if (LOG_DIAGNOSTICO && (ultimoDiagnostico == 0 ||
      (quedasDesdeDiagnostico >= QUEDAS_ATE_REDIAGNOSTICAR &&
       agora - ultimoDiagnostico >= INTERVALO_DIAGNOSTICO))) {
    ultimoDiagnostico = agora;
    quedasDesdeDiagnostico = 0;
    diagnosticoHandshake();
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
  if (LOG_ADC_PERIODICO && agora - ultimoLogADC >= INTERVALO_LOG_ADC) {
    ultimoLogADC = agora;
    logTensaoRepouso();
  }
  delay(1);
}
