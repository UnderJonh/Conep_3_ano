import asyncio
import json
import random
import ssl
import threading
import tkinter as tk
from tkinter import messagebox

import websockets


# ============================================================
# CONFIGURAÇÃO
# ============================================================

WS_HOST = "conep.developerjonh.site"
WS_PORT = 443
WS_PATH = "/ws"
WS_SECURE = True

TESTE_ID = "ba6bfa04-bd65-4918-8ada-517bca976ba7"

DEVICE_TOKEN = (
    "2167936fa8613f18c1b3e40f37cd878974604acb7ed4178454e64cdfe01a58c9"
)

URL = f"{'wss' if WS_SECURE else 'ws'}://{WS_HOST}:{WS_PORT}{WS_PATH}"


# ============================================================
# WEBSOCKET
# ============================================================

async def enviar_tensao(tensao):
    ssl_context = None

    if WS_SECURE:
        ssl_context = ssl.create_default_context()

    headers = {
        "Authorization": f"Bearer {DEVICE_TOKEN}"
    }

    try:
        async with websockets.connect(
            URL,
            ssl=ssl_context,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=20,
        ) as websocket:

            dados = {
                "teste_id": TESTE_ID,
                "device_token": DEVICE_TOKEN,
                "player": 1,
                "voltage": tensao
            }

            mensagem = json.dumps(dados)

            await websocket.send(mensagem)

            atualizar_status(
                f"✅ Enviado: {tensao:.2f} V",
                tensao
            )

            # Tenta receber uma resposta do servidor
            try:
                resposta = await asyncio.wait_for(
                    websocket.recv(),
                    timeout=2
                )

                atualizar_resposta(resposta)

            except asyncio.TimeoutError:
                atualizar_resposta("Sem resposta do servidor.")

    except Exception as erro:
        atualizar_status(
            f"❌ Erro: {erro}",
            None
        )


# ============================================================
# THREAD
# ============================================================

def executar_async(tensao):
    asyncio.run(enviar_tensao(tensao))


def enviar_valor_aleatorio():
    tensao = round(random.uniform(0, 3), 2)

    status_label.config(
        text="Enviando...",
        fg="orange"
    )

    botao_enviar.config(state="disabled")

    thread = threading.Thread(
        target=executar_async,
        args=(tensao,),
        daemon=True
    )

    thread.start()


# ============================================================
# ATUALIZAÇÃO DA INTERFACE
# ============================================================

def atualizar_status(texto, tensao):
    def atualizar():
        status_label.config(
            text=texto,
            fg="green" if tensao is not None else "red"
        )

        if tensao is not None:
            tensao_label.config(
                text=f"{tensao:.2f} V"
            )

        botao_enviar.config(state="normal")

    root.after(0, atualizar)


def atualizar_resposta(resposta):
    def atualizar():
        resposta_text.delete("1.0", tk.END)
        resposta_text.insert(
            tk.END,
            str(resposta)
        )

    root.after(0, atualizar)


# ============================================================
# INTERFACE
# ============================================================

root = tk.Tk()

root.title("Teste WebSocket - CONEP")
root.geometry("520x420")
root.resizable(False, False)


titulo = tk.Label(
    root,
    text="CROSSY ROAD · TESTE DE TENSÃO",
    font=("Arial", 18, "bold")
)

titulo.pack(pady=20)


descricao = tk.Label(
    root,
    text="Clique no botão para gerar e enviar\numa tensão aleatória entre 0 e 3 V.",
    font=("Arial", 11)
)

descricao.pack()


tensao_label = tk.Label(
    root,
    text="0.00 V",
    font=("Arial", 40, "bold")
)

tensao_label.pack(pady=25)


botao_enviar = tk.Button(
    root,
    text="⚡ GERAR E ENVIAR TENSÃO",
    font=("Arial", 14, "bold"),
    width=28,
    height=2,
    command=enviar_valor_aleatorio
)

botao_enviar.pack(pady=10)


status_label = tk.Label(
    root,
    text="Aguardando envio...",
    font=("Arial", 11)
)

status_label.pack(pady=15)


tk.Label(
    root,
    text="Resposta do servidor:",
    font=("Arial", 10, "bold")
).pack()


resposta_text = tk.Text(
    root,
    height=5,
    width=55
)

resposta_text.pack(pady=5)


root.mainloop()