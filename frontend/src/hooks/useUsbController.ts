import { useCallback, useEffect, useRef, useState } from 'react';

type Player = 1 | 2;
type Status = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
type UsbPort = {
  readonly readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};
type UsbSerial = { requestPort(): Promise<UsbPort> };

function serialApi(): UsbSerial | undefined {
  return (navigator as Navigator & { serial?: UsbSerial }).serial;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível usar a porta serial.';
}

export function useUsbController(onPress: (player: Player) => void) {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const generation = useRef(0);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const port = useRef<UsbPort | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const connecting = useRef(false);
  const lastPressAt = useRef<[number, number]>([-Infinity, -Infinity]);
  const mounted = useRef(true);
  const [status, setStatus] = useState<Status>('disconnected');
  const [error, setError] = useState('');
  const available = typeof navigator !== 'undefined' && typeof window !== 'undefined' &&
    window.isSecureContext && !!serialApi();

  const stop = useCallback(async () => {
    generation.current++;
    setStatus('disconnecting');
    try { await reader.current?.cancel(); } catch { /* A porta pode ter sido removida. */ }
    await readTask.current;
    if (mounted.current) setStatus('disconnected');
  }, []);

  const connect = useCallback(async () => {
    const serial = serialApi();
    if (!serial || !window.isSecureContext || connecting.current || port.current) return;
    connecting.current = true;
    const current = ++generation.current;
    setStatus('connecting');
    setError('');
    let selected: UsbPort | null = null;
    try {
      // requestPort precisa começar diretamente no clique do usuário.
      selected = await serial.requestPort();
      if (generation.current !== current) return;
      await selected.open({ baudRate: 115200 });
      if (generation.current !== current) { await selected.close(); return; }
      port.current = selected;
      lastPressAt.current = [-Infinity, -Infinity];
      setStatus('connected');

      const activePort = selected;
      readTask.current = (async () => {
        const decoder = new TextDecoder();
        let pending = '';
        let failure = '';
        try {
          if (!activePort.readable) throw new Error('A porta serial não oferece leitura.');
          const activeReader = activePort.readable.getReader();
          reader.current = activeReader;
          try {
            while (generation.current === current) {
              const { value, done } = await activeReader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              const lines = pending.split(/\r?\n/);
              pending = lines.pop() ?? '';
              if (pending.length > 256) pending = '';
              for (const line of lines) {
                if (generation.current !== current) break;
                const command = line.trim();
                const player = command === 'P1' ? 1 : command === 'P2' ? 2 : null;
                if (!player) continue;
                const now = performance.now();
                if (now - lastPressAt.current[player - 1] < 80) continue;
                lastPressAt.current[player - 1] = now;
                onPressRef.current(player);
              }
            }
          } finally {
            activeReader.releaseLock();
            if (reader.current === activeReader) reader.current = null;
          }
        } catch (cause) { failure = message(cause); }
        finally {
          try { await activePort.close(); } catch { /* Desconexão física. */ }
          if (port.current === activePort) port.current = null;
          if (generation.current === current && mounted.current) {
            setStatus('disconnected');
            setError(failure || 'Controle USB desconectado.');
          }
        }
      })();
    } catch (cause) {
      if (generation.current === current && mounted.current) {
        setStatus('disconnected');
        if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) setError(message(cause));
      }
    } finally { connecting.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      void reader.current?.cancel().catch(() => {});
    };
  }, []);

  return { available, status, error, connect, disconnect: stop };
}
