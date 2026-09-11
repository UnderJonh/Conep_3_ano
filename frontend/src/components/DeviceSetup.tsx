import { useEffect, useState } from 'react';
import { apiUrl, client, errorMessage } from '../lib/supabase';
import type { Teste } from '../lib/database';
import { voltage } from '../lib/format';

export function DeviceSetup({ id, teste, now, racing }: { id: string; teste: Teste; now: number; racing: boolean }) {
  const [tokens, setTokens] = useState<Record<number, string>>({});
  const [configured, setConfigured] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [pins, setPins] = useState<Record<number, number>>({ 1: 34, 2: 34 });
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void client().rpc('dispositivos_configurados', { p_teste_id: id }).then(({ data, error: err }) => {
      if (!alive) return;
      setLoaded(!err); setError(err ? errorMessage(err) : ''); if (data) setConfigured(data);
    });
    return () => { alive = false; };
  }, [id, attempt]);
  async function generate(player: 1 | 2) {
    setBusy(player); setMessage(''); setError('');
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const { error: err } = await client().rpc('configurar_dispositivo', { p_teste_id: id, p_player: player, p_token_hash: hash });
      if (err) throw err;
      setTokens(previous => ({ ...previous, [player]: token }));
      setConfigured(previous => Array.from(new Set([...previous, player])));
      setConfirm(null); setMessage(`Token do Player ${player} criado. Baixe a configuração antes de sair desta página.`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage('Copiado.'); }
    catch { setError('Não foi possível copiar automaticamente. Selecione e copie o texto.'); }
  }
  function download(player: number) {
    const literal = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    if (!ssid.trim() || /[\x00-\x1f]/.test(ssid + password)) { setError('Preencha o nome do Wi-Fi sem caracteres de controle.'); return; }
    const config = `#pragma once\n// Voltage Run · Player ${player}\n// Guarde este arquivo: ele contém a senha do Wi-Fi e o token do dispositivo.\nconst char* WIFI_SSID = ${literal(ssid)};\nconst char* WIFI_PASSWORD = ${literal(password)};\nconst char* API_URL = ${literal(apiUrl)};\nconst char* TESTE_ID = ${literal(id)};\nconst int PLAYER_ID = ${player};\nconst char* DEVICE_TOKEN = ${literal(tokens[player])};\nconst int PINO_ADC = ${pins[player]};\n`;
    const url = URL.createObjectURL(new Blob([config], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'config.h'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`config.h do Player ${player} baixado. Coloque na pasta do firmware desse ESP32.`); setError('');
  }
  return <section className="neon-panel device-setup">
    <div className="section-heading"><div><span className="eyebrow">PIT STOP · HARDWARE</span><h2>Conecte a energia à pista.</h2></div><span className="mode-tag">ESP32 · 2 DISPOSITIVOS</span></div>
    <p className="muted">Configure um ESP32 por jogador. Os passos são transmitidos por Wi-Fi para esta arena.</p>
    <ol className="setup-steps"><li><b>01</b> Escolha a rede</li><li><b>02</b> Gere os tokens</li><li><b>03</b> Grave o firmware</li><li><b>04</b> Teste os sensores</li></ol>
    <div className="wifi-settings"><label>Nome do Wi-Fi (SSID)<input value={ssid} maxLength={32} autoComplete="off" placeholder="Minha rede 2.4 GHz" onChange={e => setSsid(e.target.value)} /></label><label>Senha do Wi-Fi<input type="password" value={password} maxLength={63} autoComplete="new-password" placeholder="Vazia para rede aberta" onChange={e => setPassword(e.target.value)} /></label></div>
    <p className="small muted">A senha fica apenas nesta página e no arquivo que você baixar.</p>
    {racing ? <p className="setup-notice">Corrida em andamento. Aguarde o fim para gerar ou substituir tokens.</p> : null}
    <div className="device-grid">{([1, 2] as const).map(player => {
      const info = player === 1 ? teste.infos_player_1 : teste.infos_player_2;
      const age = info.atualizado_em ? Math.max(0, (now - Date.parse(info.atualizado_em)) / 1000) : null;
      const simulated = teste.modo === 'treino' && racing;
      const online = !simulated && age !== null && age < 5;
      return <div className={`device-card device-${player}`} key={player}>
        <div className="section-heading"><h3>ϟ PLAYER {player}</h3><span className={`device-status ${online ? 'online' : ''}`}>{simulated ? 'Treino no teclado' : online ? '● Recebendo sinal' : '○ Sem sinal recente'}</span></div>
        <div className="device-reading"><strong>{voltage(info.tensao)} <small>V</small></strong><span>{simulated ? 'Leitura simulada' : age === null ? 'Aguardando o primeiro envio' : `Última leitura há ${Math.floor(age)} s`}</span></div>
        <div className="voltage-meter"><span style={{ width: `${Math.min(100, (info.tensao ?? 0) / 3.3 * 100)}%` }} /></div>
        <p className="small">{!loaded ? 'Verificando configuração...' : configured.includes(player) ? '✓ Token configurado no Supabase' : '○ Token ainda não configurado'}</p>
        <label>Pino ADC · Player {player}<select value={pins[player]} onChange={e => setPins(previous => ({ ...previous, [player]: Number(e.target.value) }))}>{[32,33,34,35,36,39].map(pin => <option key={pin} value={pin}>GPIO {pin} · ADC1</option>)}</select></label>
        <button className="secondary" disabled={busy !== null || racing || !loaded} onClick={() => configured.includes(player) ? setConfirm(player) : void generate(player)}>{busy === player ? 'Gerando...' : configured.includes(player) ? `Substituir token Player ${player}` : `Gerar token Player ${player}`}</button>
        {confirm === player ? <div className="confirmation"><p>O token anterior deixará de funcionar. Será necessário gravar a nova configuração no ESP32.</p><div className="button-row"><button disabled={busy !== null || racing} onClick={() => void generate(player)}>Confirmar novo token</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirm(null)}>Cancelar</button></div></div> : null}
        {tokens[player] ? <><label>DEVICE_TOKEN<div className="copy-row"><input type="password" readOnly value={tokens[player]} /><button className="secondary" onClick={() => void copy(tokens[player])}>Copiar token</button></div></label><button className="download-config" disabled={!ssid.trim()} onClick={() => download(player)}>↓ Baixar config.h · Player {player}</button></> : configured.includes(player) ? <p className="small muted">Token já emitido. Use o arquivo salvo ou substitua o token para baixar outra configuração.</p> : null}
      </div>;
    })}</div>
    {error ? <p role="alert" className="error">{error}{!loaded ? <button onClick={() => setAttempt(n => n+1)}>Tentar novamente</button> : null}</p> : null}
    <p role="status" className="success">{message}</p>
    <div className="setup-help"><div><h3>Grave no seu ESP32</h3><ol><li>Abra o <a href="https://github.com/UnderJonh/Conep_3_ano/tree/main/esp32" target="_blank" rel="noreferrer">firmware do projeto ↗</a> na Arduino IDE.</li><li>Coloque <code>config.h</code>, <code>sketch.ino</code> e <code>certificados.h</code> na mesma pasta.</li><li>Selecione a placa e a porta USB. Grave o Player 1 e repita para o Player 2 com seu próprio arquivo.</li><li>Abra o Monitor Serial em <strong>115200 baud</strong>. HTTP 200 confirma os envios.</li></ol></div><div><h3>Antes da largada</h3><p>Use Wi-Fi 2.4 GHz e um pino ADC1 do ESP32 clássico. Limite a entrada física a <strong>3,3 V</strong> e compartilhe o GND.</p><p>Pise e solte: a tensão deve ultrapassar <strong>0,6 V</strong> e voltar abaixo de <strong>0,25 V</strong>. Observe o sinal acima antes de iniciar a corrida.</p><p className="small muted">Sem sinal? Confira Wi-Fi, token, UUID, pino e relógio SNTP no Monitor Serial. HTTP 401 indica token inválido.</p></div></div>
    <details className="advanced-config"><summary>Dados de conexão avançados</summary><label>TESTE_ID<div className="copy-row"><input readOnly value={id} /><button className="secondary" onClick={() => void copy(id)}>Copiar UUID</button></div></label><label>API_URL<input readOnly value={apiUrl} /></label><p className="small muted">Amostragem: 20 ms · envio em lotes: 500 ms. A escolha do tempo de corrida fica no jogo.</p></details>
  </section>;
}
