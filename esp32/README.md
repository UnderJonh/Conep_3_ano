# Firmware ESP32 · Crossy Road

Uma única placa lê dois sensores, detecta as pisadas localmente e envia comandos por uma conexão WebSocket persistente. Cada sensor controla um jogador.

## Ligações

| Sensor | Sinal padrão | Alimentação |
| --- | --- | --- |
| Jogador 1 | GPIO 34 | 3V3 e GND |
| Jogador 2 | GPIO 35 | 3V3 e GND |

Use entradas ADC1 diferentes e GND comum. Nunca aplique mais de 3,3 V aos GPIOs.

## Dependência da Arduino IDE

Instale pelo Library Manager a biblioteca **WebSockets**, de Markus Sattler (`arduinoWebSockets`). O suporte a Wi-Fi, ADC e TLS já faz parte do pacote da placa ESP32.

## Configuração

Baixe `config.h` na janela de configuração do jogo e coloque-o em `esp32/sketch/`. O arquivo contém:

- Wi-Fi 2,4 GHz;
- host, porta e caminho do gateway WebSocket;
- ID da conexão e token do dispositivo;
- GPIO de cada jogador;
- limiar de força utilizado pela detecção local.

Ao baixar o arquivo pelo site publicado, o domínio WebSocket é preenchido automaticamente com o domínio do site. Se usar o frontend local, configure `VITE_WS_URL` com um endereço que o ESP32 consiga alcançar.

## Funcionamento

1. O ESP32 conecta ao Wi-Fi e sincroniza o relógio para validar o certificado TLS.
2. Abre `wss://<domínio>/ws` uma única vez e autentica com o token da placa.
3. Lê os sensores a cada 50 ms.
4. Uma tensão acima do limiar inicia a pisada; o retorno a 0,25 V conclui o pulso.
5. O firmware envia imediatamente um pacote `command` com jogador, sessão, sequência e pico de tensão.
6. A cada 500 ms envia telemetria leve para atualizar os indicadores do navegador.

Não há fila de amostras antigas. Se o socket estiver desconectado, comandos são descartados para não movimentar o personagem atrasado após a reconexão.

## Monitor Serial

Uma inicialização normal mostra:

```text
[WS] Conectado. Autenticando dispositivo...
[WS] WebSocket autenticado. Controle pronto.
[CTRL] Jogador 1 | seq=1 | pico=2.571 V
```

Se aparecer `Dispositivo nao autorizado`, gere e grave um novo `config.h`. Se a conexão TLS falhar, confirme o domínio público e atualize `certificados.h` caso a autoridade certificadora do provedor tenha mudado.
