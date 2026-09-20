# Código do ESP32

O ESP32 lê dois sensores, um por jogador, e envia as amostras para o servidor do jogo. O servidor identifica cada pisada e o navegador movimenta o personagem correspondente.

## Arquivos

- `sketch/sketch.ino`: programa principal da placa.
- `sketch/certificados.h`: certificados públicos usados na conexão HTTPS.
- `diagram.json`: ligações da simulação no Wokwi.
- `sketch/config.h`: Wi-Fi, endereço do servidor, token e pinos dos sensores. É gerado pelo jogo e não deve ser enviado ao Git.

## Ligações

Cada sensor usa um pino ADC1 diferente e ambos compartilham o GND da placa:

| Sensor | Sinal padrão | Alimentação |
|---|---|---|
| Jogador 1 | `GPIO 34` | `3V3` e `GND` |
| Jogador 2 | `GPIO 35` | `3V3` e `GND` |

Nunca envie mais de **3,3 V** a um GPIO. Ao trocar os pinos, escolha duas entradas ADC1 compatíveis com a placa.

## Funcionamento

1. O ESP32 conecta ao Wi-Fi e sincroniza o relógio.
2. Uma tarefa lê os dois sensores a cada 20 ms.
3. As leituras de cada jogador ficam em uma fila independente com 100 posições.
4. A cada 200 ms, o firmware prepara os dois lotes e os envia na mesma requisição HTTPS.
5. O pedido usa o token da placa uma única vez e mantém as amostras de cada jogador separadas.

Exemplo do conteúdo enviado:

```json
{
  "teste_id": "UUID_DA_SESSAO",
  "leituras": [
    {
      "player": 1,
      "amostras": [{ "tensao": 1.742, "instante_ms": 1789823456789 }]
    },
    {
      "player": 2,
      "amostras": [{ "tensao": 2.104, "instante_ms": 1789823456789 }]
    }
  ]
}
```

O token da placa é enviado no cabeçalho `X-Device-Token`.

## Principais configurações

- `PINO_ADC_PLAYER_1`: sensor do jogador 1; o padrão é 34.
- `PINO_ADC_PLAYER_2`: sensor do jogador 2; o padrão é 35.
- `INTERVALO_AMOSTRA`: tempo entre leituras; o padrão é 20 ms.
- `INTERVALO_ENVIO`: tempo entre envios; o padrão é 200 ms.

Se uma fila encher, a leitura mais antiga daquele jogador é descartada. Leituras com mais de 2 segundos também não são enviadas, evitando que uma pisada antiga apareça depois de uma queda de rede.

## Monitor Serial

Abra o Monitor Serial em **115200 baud**. Uma resposta normal é:

```text
Jogador: 2 | Tensao: 1.742 V | HTTP: 200 | Amostras: 10 | RSSI: -48 dBm
```

- `HTTP 200`: envio realizado.
- `HTTP 4xx`: configuração, token ou requisição recusada.
- `HTTP 5xx`: erro no servidor.
- código negativo: falha de conexão, HTTPS ou timeout.
