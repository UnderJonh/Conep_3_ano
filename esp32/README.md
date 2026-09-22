# Firmware ESP32 · Controle do Crossy Road

A placa é só um controle de dois botões iluminados. Não usa Wi-Fi, nuvem, banco de dados nem certificado: liga no computador pelo cabo USB e o navegador lê a porta serial pela Web Serial API.

## Ligações

| Jogador | Botão | LED do botão | Tecla que o jogo simula |
| --- | --- | --- | --- |
| 1 | GPIO 25 | GPIO 32 | `ESPAÇO` |
| 2 | GPIO 26 | GPIO 33 | `ENTER` |

### Botão

Os GPIOs 25 e 26 usam o **pull-up interno**. Cada botão liga o GPIO ao GND quando é apertado:

```text
GPIO 25 (ou 26) ---- botão ---- GND
```

Sem botão conectado, o pull-up interno mantém o GPIO em nível alto e não há comandos. Ao apertar, o pino vai a nível baixo.

### LED

O LED é o **contrário** do botão: fica aceso esperando o toque e apaga enquanto o botão está apertado.

| Botão | Pino do botão lê | LED |
| --- | --- | --- |
| Solto | `1` | Aceso (`1`) |
| Apertado | `0` | Apagado (`0`) |

Um GPIO do ESP32 entrega no máximo ~20 mA, então o LED precisa de resistor em série — a não ser que o LED que vem dentro do botão já tenha um:

```text
GPIO 32 (ou 33) ---- 220R ---- LED ---- GND
```

Se o botão for de 5 V ou 12 V, não ligue direto no GPIO: use um transistor ou um módulo de relé.

Nunca aplique mais de 3,3 V aos GPIOs. Use GND comum.

## Dependências

Nenhuma biblioteca externa. Basta o pacote da placa ESP32 instalado na Arduino IDE.

## Como gravar

1. Abra `esp32/sketch/sketch.ino` na Arduino IDE.
2. Selecione sua placa ESP32 e a porta USB.
3. Grave o firmware.
4. Abra o Monitor Serial em **115200 baud**.

No boot a placa envia sua identificação e acende os dois LEDs. Apertando um botão, o LED dele apaga e aparece `P1` ou `P2`.

## Protocolo da serial

115200 baud, uma mensagem por linha:

| Mensagem | Significado |
| --- | --- |
| `ID CROSSY-CONTROLE v1` | Identificação enviada no boot. |
| `P1` | Botão do jogador 1. O navegador simula a tecla `ESPAÇO`. |
| `P2` | Botão do jogador 2. O navegador simula a tecla `ENTER`. |

A placa não manda tecla nenhuma: ela só avisa qual botão foi apertado. Quem transforma `P1` em `ESPAÇO` é o site, que já usa essas duas teclas no multiplayer local.

O comando sai uma vez ao apertar. Cada botão só aceita outro toque depois de permanecer solto por 50 ms, evitando comandos repetidos pela oscilação do contato.

## Se não funcionar

| Sintoma | Causa provável |
| --- | --- |
| O personagem anda sozinho sem nada ligado aos GPIOs 25/26 | Confira se o firmware novo foi gravado e se a placa está executando esse sketch. O Monitor Serial deve mostrar `ID CROSSY-CONTROLE v1` ao iniciar. |
| Aparecem muitos `P1`/`P2` com os botões conectados | Confira se cada botão liga o GPIO 25/26 ao GND só enquanto é apertado. |
| Sai um comando ao soltar, em vez de apertar | Confira se o botão liga o GPIO ao GND ao apertar e se não está usando o contato normalmente fechado. |
| Um aperto move duas vezes | O contato pode oscilar ao apertar ou soltar; confira os eventos `P1`/`P2` no Monitor Serial e o tratamento no jogo. |
| O LED continua apagado após soltar | O GPIO continua em nível baixo. Confira a ligação do botão ao GND. |
| O LED nunca acende | Polaridade invertida, ou falta o resistor em série. |
| O LED fica aceso mesmo apertando | O botão não está chegando no GPIO. Confira no Monitor Serial se aparece `P1`/`P2`. |
| Nada aparece no Monitor Serial | Baud errado (tem que ser 115200) ou porta errada. |
| O navegador mostra `Failed to open serial port` | Feche o Monitor Serial, o Plotter Serial e outros programas ou abas que usam a porta. Selecione a porta da ESP32 e tente novamente. |
| Aparece `P1`/`P2` no monitor mas o jogo não anda | O Monitor Serial está ocupando a porta. Feche-o antes de conectar pelo navegador. |
