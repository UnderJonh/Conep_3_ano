import { useState } from 'react';
import { apiUrl, client, errorMessage } from '../lib/supabase';

export function DeviceSetup({ id }: { id: string }) {
  const [tokens, setTokens] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  async function generate(player: 1 | 2) {
    setBusy(player);
    setMessage('');
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      const { error } = await client().rpc('configurar_dispositivo', { p_teste_id: id, p_player: player, p_token_hash: hash });
      if (error) throw error;
      setTokens((previous) => ({ ...previous, [player]: token }));
      setMessage(`Token do Player ${player} criado. Copie antes de sair desta página.`);
    } catch (err) { setMessage(errorMessage(err)); }
    finally { setBusy(null); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Copiado.'); }
    catch { setMessage('Não foi possível copiar automaticamente. Selecione e copie o texto.'); }
  }
  return <details className="surface device-setup">
    <summary>Configurar dispositivos</summary>
    <div className="setup-content">
      <p>Use um token próprio para cada ESP32. Gerar outro token substitui imediatamente o anterior.</p>
      <label>TESTE_ID<div className="copy-row"><input readOnly value={id} /><button className="secondary" onClick={() => void copy(id)}>Copiar UUID</button></div></label>
      <label>API_URL<input readOnly value={apiUrl} /></label>
      <div className="device-grid">{([1, 2] as const).map((player) => <div key={player}>
        <h3>Player {player}</h3><p className="small muted">PLAYER_ID = {player}</p>
        <button className="secondary" disabled={busy !== null} onClick={() => void generate(player)}>
          {busy === player ? 'Gerando...' : `Gerar token Player ${player}`}
        </button>
        {tokens[player] ? <label>DEVICE_TOKEN<div className="copy-row"><input readOnly value={tokens[player]} /><button className="secondary" onClick={() => void copy(tokens[player])}>Copiar token</button></div></label> : null}
      </div>)}</div>
      <p className="small" role="status">{message}</p>
    </div>
  </details>;
}
