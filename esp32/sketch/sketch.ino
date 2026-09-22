bool anterior1 = false;
bool anterior2 = false;
unsigned long ultimoLow1 = 0;
unsigned long ultimoLow2 = 0;

void setup() {
  Serial.begin(115200);
  pinMode(25, INPUT);
  pinMode(26, INPUT);
  pinMode(32, OUTPUT);
  pinMode(33, OUTPUT);
  digitalWrite(32, HIGH);
  digitalWrite(33, HIGH);
  Serial.println("ID CROSSY-CONTROLE v1");
}

void loop() {
  bool p1 = digitalRead(25) == LOW;
  bool p2 = digitalRead(26) == LOW;

  digitalWrite(32, p1 ? LOW : HIGH);
  digitalWrite(33, p2 ? LOW : HIGH);

  if (p1) {
    ultimoLow1 = millis();
    if (!anterior1) {
      anterior1 = true;
      Serial.println("P1"); // Espaco
    }
  } else if (anterior1 && millis() - ultimoLow1 >= 50) {
    anterior1 = false;
  }

  if (p2) {
    ultimoLow2 = millis();
    if (!anterior2) {
      anterior2 = true;
      Serial.println("P2"); // Enter
    }
  } else if (anterior2 && millis() - ultimoLow2 >= 50) {
    anterior2 = false;
  }
}
