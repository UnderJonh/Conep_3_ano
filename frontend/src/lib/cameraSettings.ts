import type { CameraProfile, CameraSettings, CameraTuning } from './camera';
import { defaultCameraSettings, normalizeCameraSettings, normalizeCameraTuning } from './camera';
import type { CameraSettingsRow } from './database';
import { ensureSession } from './session';
import { client, supabase } from './supabase';

function fromRow(row: CameraSettingsRow): CameraTuning {
  return normalizeCameraTuning(row, defaultCameraSettings[row.profile]);
}

export function mergeCameraRow(settings: CameraSettings, row: CameraSettingsRow): CameraSettings {
  return { ...settings, [row.profile]: fromRow(row) };
}

export async function loadCameraSettings(): Promise<CameraSettings> {
  if (!supabase) return normalizeCameraSettings(defaultCameraSettings);
  const result = await client().from('crossy_camera_settings').select('*');
  if (result.error) throw result.error;
  return (result.data ?? []).reduce(mergeCameraRow, normalizeCameraSettings(defaultCameraSettings));
}

export async function saveCameraProfile(profile: CameraProfile, value: CameraTuning): Promise<CameraSettingsRow> {
  await ensureSession();
  const tuning = normalizeCameraTuning(value, defaultCameraSettings[profile]);
  const result = await client().from('crossy_camera_settings').update({
    ...tuning,
    updated_at: new Date().toISOString(),
  }).eq('profile', profile).select().single();
  if (result.error) throw result.error;
  return result.data;
}

export function subscribeCameraSettings(
  onChange: (row: CameraSettingsRow) => void,
  onStatus?: (status: string) => void,
) {
  if (!supabase) return () => {};
  const db = client();
  const channel = db.channel('crossy-camera-settings')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'crossy_camera_settings',
    }, payload => onChange(payload.new as CameraSettingsRow))
    .subscribe(status => onStatus?.(status));
  return () => { void db.removeChannel(channel); };
}
