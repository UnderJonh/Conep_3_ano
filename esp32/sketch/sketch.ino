const int pinosBotao[2] = {34, 35};
const int pinosLed[2] = {32, 33};
bool pressionado[2] = {false, false};

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 2; i++) {
    pinMode(pinosBotao[i], INPUT);
    pinMode(pinosLed[i], OUTPUT);
    digitalWrite(pinosLed[i], HIGH);
  }
  Serial.println("ID CROSSY-CONTROLE v1");
}

void loop() {
  while (Serial.available()) {
    if (Serial.read() == '?') Serial.println("ID CROSSY-CONTROLE v1");
  }

  for (int i = 0; i < 2; i++) {
    bool leitura = digitalRead(pinosBotao[i]) == HIGH;
    if (leitura == pressionado[i]) continue;

    pressionado[i] = leitura;
    digitalWrite(pinosLed[i], leitura ? LOW : HIGH);
    if (leitura) Serial.println(i == 0 ? "P1" : "P2");
  }
}
