import { useEffect, useState } from 'react';
import { apiUrl, client, errorMessage } from '../lib/supabase';
import type { Teste } from '../lib/database';

export function CrossyEspSetup({ teste, error: connectionError, connecting, connected, enable }: {
  teste: Teste | null; error: string; connecting: boolean; connected: boolean; enable(): void;
}) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState(34);
  const [threshold, setThreshold] = useState(1.5);
  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (teste) setThreshold(teste.limiar_forte); }, [teste?.limiar_forte]);
  useEffect(() => {
    if (!teste) return;
    let alive = true;
    void client().rpc('dispositivos_configurados', { p_teste_id: teste.id }).then(result => {
      if (!alive) return;
      if (result.error) setError(errorMessage(result.error));
      else { setConfigured(result.data.includes(1)); setLoaded(true); }
    });
    return () => { alive = false; };
  }, [teste?.id]);
  async function generate() {
    if (!teste) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const result = await client().rpc('configurar_dispositivo', { p_teste_id: teste.id, p_player: 1, p_token_hash: hash });
      if (result.error) throw result.error;
      setToken(value); setConfigured(true); setConfirm(false);
      setMessage('Token gerado. Baixe config.h e coloque na pasta do firmware.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function saveThreshold() {
    if (!teste) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await client().rpc('configurar_crossy', { p_teste_id: teste.id, p_limiar: threshold });
      if (result.error) throw result.error;
      setMessage('Força mínima salva. Pise e solte para testar o sinal.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  function download() {
    if (!teste || !token) return;
    if (!ssid.trim() || /[\x00-\x1f]/.test(ssid + password)) { setError('Informe o nome do Wi-Fi sem caracteres de controle.'); return; }
    const text = `#pragma once\n// Crossy Road · CONEP · uma placa\nconst char* WIFI_SSID = ${JSON.stringify(ssid)};\nconst char* WIFI_PASSWORD = ${JSON.stringify(password)};\nconst char* API_URL = ${JSON.stringify(apiUrl)};\nconst char* TESTE_ID = ${JSON.stringify(teste.id)};\nconst int PLAYER_ID = 1;\nconst char* DEVICE_TOKEN = ${JSON.stringify(token)};\nconst int PINO_ADC = ${pin};\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'config.h'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('config.h baixado. Grave o firmware na sua placa ESP32.');
  }
  const info = teste?.infos_player_1;
  const age = info?.atualizado_em ? now - Date.parse(info.atualizado_em) : Infinity;
  const online = connected && age < 5000;
  return <div className="esp-setup">
    <p>Uma placa. Uma função: mover a galinha para frente com uma pisada forte.</p>
    <div className={`esp-signal ${online ? 'online' : ''}`}><span className="signal-dot" /><span>{connecting ? 'Preparando conexão…' : online ? 'Recebendo sinal do ESP32' : 'Aguardando sinal do ESP32'}</span><strong>{Number(info?.tensao ?? 0).toFixed(2)} V</strong></div>
    <progress aria-label="Tensão do sensor" max={3.3} value={Number(info?.tensao ?? 0)} />
    <p className="small">{connected ? 'Navegador conectado' : 'Navegador desconectado'} · {info?.atualizado_em ? `Último envio há ${Math.max(0, Math.floor(age / 1000))} s` : 'Nenhum envio recebido'}</p>
    {connectionError ? <div role="alert" className="setup-error">{connectionError}<button onClick={enable} disabled={connecting}>Tentar conexão novamente</button></div> : null}
    <fieldset disabled={!teste || busy || connecting}>
      <legend>Conexão da placa</legend>
      <label>Nome do Wi-Fi (SSID)<input value={ssid} onChange={event => setSsid(event.target.value)} placeholder="Rede 2.4 GHz" maxLength={32} autoComplete="off" /></label>
      <label>Senha do Wi-Fi<input type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={63} autoComplete="new-password" placeholder="Vazia para rede aberta" /></label>
      <label>Pino do sensor<select value={pin} onChange={event => setPin(Number(event.target.value))}>{[32, 33, 34, 35, 36, 39].map(value => <option key={value} value={value}>GPIO {value} · ADC1</option>)}</select></label>
      <label>Força mínima da pisada · {threshold.toFixed(2)} V<input type="range" min="0.6" max="3.3" step="0.05" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></label>
      <p className="small">Aumente o limite para exigir uma pisada mais forte. Solte o sensor até 0,25 V antes de pisar novamente.</p>
      <button className="secondary-button" onClick={() => void saveThreshold()}>Salvar força mínima</button>
      <div className="token-controls"><button disabled={!loaded || busy} onClick={() => configured ? setConfirm(true) : void generate()}>{busy ? 'Salvando…' : configured ? 'Substituir token da placa' : 'Gerar token da placa'}</button>
      {confirm ? <div className="token-confirm"><p>O token anterior será desativado. Grave o novo config.h no ESP32.</p><button onClick={() => void generate()}>Gerar novo token</button><button className="secondary-button" onClick={() => setConfirm(false)}>Cancelar</button></div> : null}
      {token ? <><label>Token da placa<input type="password" readOnly value={token} /></label><button disabled={!ssid.trim()} onClick={download}>Baixar config.h</button></> : configured ? <p className="small">Use o config.h já salvo. Para baixar outro, substitua o token.</p> : null}</div>
    </fieldset>
    {error ? <p role="alert" className="setup-error">{error}</p> : null}
    <p role="status" className="setup-message">{message}</p>
    <details><summary>Como gravar a placa</summary><ol><li>Abra <code>esp32/sketch.ino</code> na Arduino IDE.</li><li>Coloque o <code>config.h</code> baixado junto de <code>sketch.ino</code> e <code>certificados.h</code>.</li><li>Selecione sua ESP32 e a porta USB e grave o firmware.</li><li>Abra o Monitor Serial em 115200 baud. HTTP 200 confirma o envio.</li></ol><p className="small">Use um sensor com GND comum e entrada máxima de 3,3 V no GPIO.</p>{teste ? <label>ID da conexão<input readOnly value={teste.id} /></label> : null}<label>Endereço de envio<input readOnly value={apiUrl} /></label></details>
  </div>;
}
