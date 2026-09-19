# Código do ESP32

O ESP32 lê a tensão do sensor e envia as amostras para o servidor do jogo. O servidor identifica as pisadas e o navegador movimenta a galinha.

## Arquivos

- `sketch/sketch.ino`: programa principal da placa.
- `sketch/certificados.h`: certificados públicos usados na conexão HTTPS.
- `diagram.json`: ligações da simulação no Wokwi.
- `sketch/config.h`: Wi-Fi, endereço do servidor e token da placa. É gerado pelo jogo e não deve ser enviado ao Git.

## Ligações

Na simulação, o potenciômetro representa o sensor:

| Potenciômetro | ESP32 |
|---|---|
| `VCC` | `3V3` |
| `GND` | `GND` |
| `SIG` | `GPIO 34` |

Nunca envie mais de **3,3 V** ao GPIO. Ao trocar o pino, use uma entrada ADC1 compatível com a placa.

## Funcionamento

1. O ESP32 conecta ao Wi-Fi e sincroniza o relógio.
2. Uma tarefa lê o sensor a cada 20 ms.
3. As leituras ficam em uma fila com 100 posições.
4. O programa reúne as leituras recentes a cada 200 ms.
5. Um JSON é enviado por HTTPS para a Edge Function `receber-tensao`.

Exemplo do conteúdo enviado:

```json
{
  "teste_id": "UUID_DA_SESSAO",
  "player": 1,
  "amostras": [
    { "tensao": 1.742, "instante_ms": 1789823456789 }
  ]
}
```

O token da placa é enviado no cabeçalho `X-Device-Token`.

## Principais configurações

- `PINO_ADC`: pino ligado ao sensor; o padrão é 34.
- `INTERVALO_AMOSTRA`: tempo entre leituras; o padrão é 20 ms.
- `INTERVALO_ENVIO`: tempo entre envios; o padrão é 200 ms.
- `PLAYER_ID`: deve permanecer com o valor 1.

Se a fila encher, a leitura mais antiga é descartada. Leituras com mais de 2 segundos também não são enviadas, evitando que uma pisada antiga apareça depois de uma queda de rede.

## Monitor Serial

Abra o Monitor Serial em **115200 baud**. Uma resposta normal é:

```text
Tensao: 1.742 V | HTTP: 200 | Amostras: 10
```

- `HTTP 200`: envio realizado.
- `HTTP 4xx`: configuração, token ou requisição recusada.
- `HTTP 5xx`: erro no servidor.
- código negativo: falha de conexão, HTTPS ou timeout.
