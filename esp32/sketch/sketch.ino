/*
 * ESP32 - Crossy Road CONEP | controle USB
 *
 * A placa e so um controle de dois botoes iluminados. Nao usa Wi-Fi, nuvem nem
 * certificado: liga no computador pelo cabo USB e o navegador le a porta
 * serial pela Web Serial API.
 *
 *   GPIO 34 -> botao do jogador 1   | GPIO 32 -> LED desse botao
 *   GPIO 35 -> botao do jogador 2   | GPIO 33 -> LED desse botao
 *
 * O LED e o contrario do botao: fica aceso esperando o toque e apaga enquanto
 * o botao esta apertado.
 *
 *   botao solto    (0) -> LED aceso  (1)
 *   botao apertado (1) -> LED apagado (0)
 *
 * Ligacao do botao. GPIO 34 e 35 sao so de entrada e NAO tem resistor interno,
 * entao o resistor externo e obrigatorio:
 *
 *     3V3 ---- botao ----+---- GPIO 34 (ou 35)
 *                        |
 *                       10k
 *                        |
 *                       GND
 *
 * Sem o resistor o pino fica solto, pega ruido e dispara sozinho.
 *
 * Ligacao do LED. O GPIO do ESP32 entrega no maximo ~20 mA, entao precisa de
 * resistor em serie, a nao ser que o LED do botao ja venha com um:
 *
 *     GPIO 32 (ou 33) ---- 220R ---- LED ---- GND
 *
 * Protocolo da serial (115200 baud, uma mensagem por linha):
 *   ID CROSSY-CONTROLE v1  -> identificacao, no boot e quando recebe '?'
 *   P1                     -> botao do jogador 1: o jogo simula a tecla ESPACO
 *   P2                     -> botao do jogador 2: o jogo simula a tecla ENTER
 *   # ...                  -> comentario para humano, o navegador ignora
 */

const int PINO_BOTAO_1 = 34;
const int PINO_LED_1 = 32;
const int PINO_BOTAO_2 = 35;
const int PINO_LED_2 = 33;

const unsigned long DEBOUNCE = 30;            // ms de contato estavel antes de valer
const unsigned long INTERVALO_ESTADO = 5000;  // ms entre as linhas de status

#define LOG_ESTADO 1  // 0 desliga as linhas "#" periodicas

const char* IDENTIFICACAO = "ID CROSSY-CONTROLE v1";

struct Botao {
  int pino;
  int pinoLed;
  int jogador;
  const char* tecla;  // tecla que o jogo simula quando este botao e apertado
  bool pressionado;
  bool ultimaLeitura;
  unsigned long mudouEm;
  uint32_t toques;
};

Botao botoes[2] = {
  { PINO_BOTAO_1, PINO_LED_1, 1, "ESPACO", false, false, 0, 0 },
  { PINO_BOTAO_2, PINO_LED_2, 2, "ENTER", false, false, 0, 0 },
};

unsigned long ultimoEstado = 0;

// O LED e o inverso do botao: aceso enquanto ninguem aperta.
void atualizarLed(const Botao& botao) {
  digitalWrite(botao.pinoLed, botao.pressionado ? LOW : HIGH);
}

void enviarToque(Botao& botao) {
  botao.toques++;
  Serial.printf("P%d\n", botao.jogador);
}

void lerBotao(Botao& botao, unsigned long agora) {
  const bool leitura = digitalRead(botao.pino) == HIGH;

  // Qualquer oscilacao reinicia a contagem do debounce.
  if (leitura != botao.ultimaLeitura) {
    botao.ultimaLeitura = leitura;
    botao.mudouEm = agora;
    return;
  }
  if (agora - botao.mudouEm < DEBOUNCE) return;
  if (leitura == botao.pressionado) return;

  botao.pressionado = leitura;
  atualizarLed(botao);
  if (botao.pressionado) enviarToque(botao);
}

void lerSerial() {
  while (Serial.available()) {
    const char comando = Serial.read();
    if (comando == '?') Serial.println(IDENTIFICACAO);
  }
}

void logEstado() {
  Serial.printf("# J1 %s LED=%d (%lu toques) | J2 %s LED=%d (%lu toques) | %lu s ligado\n",
    botoes[0].pressionado ? "apertado" : "solto  ", botoes[0].pressionado ? 0 : 1,
    (unsigned long)botoes[0].toques,
    botoes[1].pressionado ? "apertado" : "solto  ", botoes[1].pressionado ? 0 : 1,
    (unsigned long)botoes[1].toques,
    millis() / 1000UL);
}

void setup() {
  Serial.begin(115200);
  for (Botao& botao : botoes) {
    pinMode(botao.pino, INPUT);
    pinMode(botao.pinoLed, OUTPUT);
    atualizarLed(botao);  // comeca aceso, esperando o toque
  }
  delay(300);

  Serial.println();
  Serial.println(IDENTIFICACAO);
  for (const Botao& botao : botoes) {
    Serial.printf("# Jogador %d: botao no GPIO %d, LED no GPIO %d, tecla %s\n",
      botao.jogador, botao.pino, botao.pinoLed, botao.tecla);
  }
  Serial.println("# Botao: 3V3 -> botao -> GPIO, com resistor de 10k do GPIO ao GND.");
  Serial.println("# LED: GPIO -> 220R -> LED -> GND. Aceso parado, apaga ao apertar.");
  Serial.println("# Aperte um botao para ver P1 ou P2. Envie '?' para a placa se identificar.");
}

void loop() {
  const unsigned long agora = millis();

  lerSerial();
  for (Botao& botao : botoes) lerBotao(botao, agora);

  if (LOG_ESTADO && agora - ultimoEstado >= INTERVALO_ESTADO) {
    ultimoEstado = agora;
    logEstado();
  }
  delay(1);
}
