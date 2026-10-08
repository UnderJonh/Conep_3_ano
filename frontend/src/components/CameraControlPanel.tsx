import { useState } from 'react';
import type { CameraProfile, CameraSettings, CameraTuning } from '../lib/camera';
import type { CameraSyncStatus } from '../hooks/useCameraSettings';

type Props = {
  open: boolean;
  settings: CameraSettings;
  status: CameraSyncStatus;
  syncError: string;
  onChange(profile: CameraProfile, value: CameraTuning): void;
  onReset(profile: CameraProfile): void;
  onClose(): void;
};

type SliderProps = {
  id: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  suffix: string;
  onChange(value: number): void;
};

const statusText: Record<CameraSyncStatus, string> = {
  loading: 'Conectando…',
  saving: 'Salvando…',
  synced: 'Sincronizado',
  local: 'Somente neste aparelho',
  error: 'Falha na sincronização',
};

function CameraSlider({ id, label, hint, min, max, value, suffix, onChange }: SliderProps) {
  return <label className="camera-slider" htmlFor={id}>
    <span><strong>{label}</strong><output htmlFor={id}>{Math.round(value)}{suffix}</output></span>
    <input id={id} type="range" min={min} max={max} step="1" value={Math.round(value)} onChange={event => onChange(Number(event.target.value))} />
    <small>{hint}</small>
  </label>;
}

export function CameraControlPanel({ open, settings, status, syncError, onChange, onReset, onClose }: Props) {
  const [profile, setProfile] = useState<CameraProfile>('desktop');
  if (!open) return null;
  const current = settings[profile];
  const change = (patch: Partial<CameraTuning>) => onChange(profile, { ...current, ...patch });

  return <aside className="camera-control-panel" aria-label="Controle de câmera" data-profile={profile}>
    <div className="camera-panel-heading">
      <div><strong>Controle de câmera</strong><span className={`camera-sync-status is-${status}`} aria-live="polite">{statusText[status]}</span></div>
      <button type="button" aria-label="Fechar controle de câmera" onClick={onClose}>×</button>
    </div>
    <div className="camera-profile-switch" role="group" aria-label="Tela configurada">
      <button type="button" aria-pressed={profile === 'desktop'} onClick={() => setProfile('desktop')}>PC</button>
      <button type="button" aria-pressed={profile === 'mobile'} onClick={() => setProfile('mobile')}>Celular</button>
    </div>
    <CameraSlider id={`camera-${profile}-horizontal`} label="Horizontal" hint="− esquerda  /  + direita" min={-30} max={30} value={current.horizontal * 100} suffix="%" onChange={value => change({ horizontal: value / 100 })} />
    <CameraSlider id={`camera-${profile}-vertical`} label="Vertical" hint="− cima  /  + baixo" min={-30} max={30} value={current.vertical * 100} suffix="%" onChange={value => change({ vertical: value / 100 })} />
    <CameraSlider id={`camera-${profile}-zoom`} label="Zoom" hint="Tamanho do cenário e personagem" min={60} max={160} value={current.zoom * 100} suffix="%" onChange={value => change({ zoom: value / 100 })} />
    {syncError ? <p className="camera-sync-error" role="alert">{syncError}</p> : null}
    <button type="button" className="camera-reset" onClick={() => onReset(profile)}>Restaurar {profile === 'desktop' ? 'PC' : 'celular'}</button>
  </aside>;
}
