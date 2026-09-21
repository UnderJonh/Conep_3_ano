# Firmware ESP32 · Controle do Crossy Road

A placa é só um controle de dois botões iluminados. Não usa Wi-Fi, nuvem, banco de dados nem certificado: liga no computador pelo cabo USB e o navegador lê a porta serial pela Web Serial API.

## Ligações

| Jogador | Botão | LED do botão | Tecla que o jogo simula |
| --- | --- | --- | --- |
| 1 | GPIO 34 | GPIO 32 | `ESPAÇO` |
| 2 | GPIO 35 | GPIO 33 | `ENTER` |

### Botão

`GPIO 34` e `35` são **só de entrada e não têm resistor interno**. Cada botão precisa do seu resistor de pull-down externo:

```text
3V3 ---- botão ----+---- GPIO 34 (ou 35)
                   |
                  10k
                   |
                  GND
```

Sem o resistor o pino fica solto, pega ruído do ambiente e o personagem anda sozinho. Com ele, o pino fica em 0 V parado e vai a 3,3 V só enquanto o botão estiver apertado.

### LED

O LED é o **contrário** do botão: fica aceso esperando o toque e apaga enquanto o botão está apertado.

| Botão | Pino do botão lê | LED |
| --- | --- | --- |
| Solto | `0` | Aceso (`1`) |
| Apertado | `1` | Apagado (`0`) |

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

No boot a placa se apresenta e explica a ligação. Os dois LEDs acendem. Apertando um botão o LED dele apaga e aparece `P1` ou `P2`.

## Protocolo da serial

115200 baud, uma mensagem por linha:

| Mensagem | Significado |
| --- | --- |
| `ID CROSSY-CONTROLE v1` | Identificação. Enviada no boot e sempre que a placa recebe `?`. |
| `P1` | Botão do jogador 1. O navegador simula a tecla `ESPAÇO`. |
| `P2` | Botão do jogador 2. O navegador simula a tecla `ENTER`. |
| `# ...` | Comentário para humano ler. O navegador ignora. |

A placa não manda tecla nenhuma: ela só avisa qual botão foi apertado. Quem transforma `P1` em `ESPAÇO` é o site, que já usa essas duas teclas no multiplayer local.

O comando só sai na **descida do botão**, nunca enquanto ele fica segurado. Um toque, um comando.

## Ajustes

Todas as constantes ficam no topo do `sketch.ino`:

| Constante | Padrão | Para quê |
| --- | --- | --- |
| `PINO_BOTAO_1` / `PINO_BOTAO_2` | `34` / `35` | GPIO de cada botão. |
| `PINO_LED_1` / `PINO_LED_2` | `32` / `33` | GPIO do LED de cada botão. |
| `DEBOUNCE` | `30` ms | Tempo de contato estável antes do toque valer. Aumente se um aperto virar dois. |
| `INTERVALO_ESTADO` | `5000` ms | Intervalo das linhas `#` de status. |
| `LOG_ESTADO` | `1` | `0` desliga as linhas de status. |

## Se não funcionar

| Sintoma | Causa provável |
| --- | --- |
| O personagem anda sozinho | Falta o resistor de pull-down de 10 kΩ no botão. |
| Um aperto move duas vezes | Aumente `DEBOUNCE`. |
| O LED nunca acende | Polaridade invertida, ou falta o resistor em série. |
| O LED fica aceso mesmo apertando | O botão não está chegando no GPIO. Confira no Monitor Serial se aparece `P1`/`P2`. |
| Nada aparece no Monitor Serial | Baud errado (tem que ser 115200) ou porta errada. |
| Aparece `P1`/`P2` no monitor mas o jogo não anda | O Monitor Serial está ocupando a porta. Feche-o antes de conectar pelo navegador. |
