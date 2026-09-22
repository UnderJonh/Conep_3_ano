bool anterior1 = false;
bool anterior2 = false;

void setup() {
  Serial.begin(115200);
  pinMode(34, INPUT);
  pinMode(35, INPUT);
  pinMode(32, OUTPUT);
  pinMode(33, OUTPUT);
  digitalWrite(32, HIGH);
  digitalWrite(33, HIGH);
  Serial.println("ID CROSSY-CONTROLE v1");
}

void loop() {
  bool p1 = digitalRead(34) == HIGH;
  bool p2 = digitalRead(35) == HIGH;

  digitalWrite(32, p1 ? LOW : HIGH);
  digitalWrite(33, p2 ? LOW : HIGH);

  if (p1 && !anterior1) Serial.println("P1"); // Espaço
  if (p2 && !anterior2) Serial.println("P2"); // Enter

  anterior1 = p1;
  anterior2 = p2;
}
