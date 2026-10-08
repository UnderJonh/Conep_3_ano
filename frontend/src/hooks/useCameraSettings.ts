import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraProfile, CameraSettings, CameraTuning } from '../lib/camera';
import { defaultCameraSettings, normalizeCameraSettings, normalizeCameraTuning } from '../lib/camera';
import { loadCameraSettings, mergeCameraRow, saveCameraProfile, subscribeCameraSettings } from '../lib/cameraSettings';
import { errorMessage, supabase } from '../lib/supabase';

export type CameraSyncStatus = 'loading' | 'synced' | 'saving' | 'local' | 'error';

const profiles: CameraProfile[] = ['desktop', 'mobile'];

export function useCameraSettings() {
  const [settings, setSettings] = useState<CameraSettings>(() => normalizeCameraSettings(defaultCameraSettings));
  const [status, setStatus] = useState<CameraSyncStatus>(supabase ? 'loading' : 'local');
  const [syncError, setSyncError] = useState('');
  const pending = useRef<Partial<Record<CameraProfile, number>>>({});
  const editVersion = useRef<Record<CameraProfile, number>>({ desktop: 0, mobile: 0 });
  const dirty = useRef(new Set<CameraProfile>());

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const stop = subscribeCameraSettings(row => {
      if (!active || dirty.current.has(row.profile)) return;
      setSettings(current => mergeCameraRow(current, row));
    }, realtimeStatus => {
      if (!active) return;
      if (realtimeStatus === 'SUBSCRIBED') setStatus(current => current === 'saving' ? current : 'synced');
      else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(realtimeStatus)) {
        setStatus('error');
        setSyncError('A atualização em tempo real está indisponível.');
      }
    });

    void loadCameraSettings().then(loaded => {
      if (!active) return;
      setSettings(current => profiles.reduce((next, profile) => dirty.current.has(profile)
        ? next
        : { ...next, [profile]: loaded[profile] }, current));
      setStatus(current => current === 'saving' ? current : 'synced');
      setSyncError('');
    }).catch(error => {
      if (!active) return;
      setStatus('error');
      setSyncError(errorMessage(error));
    });

    return () => {
      active = false;
      stop();
      for (const timeout of Object.values(pending.current)) if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  const updateProfile = useCallback((profile: CameraProfile, value: CameraTuning) => {
    const tuning = normalizeCameraTuning(value, defaultCameraSettings[profile]);
    const version = ++editVersion.current[profile];
    dirty.current.add(profile);
    setSettings(current => ({ ...current, [profile]: tuning }));
    setSyncError('');

    if (!supabase) {
      setStatus('local');
      return;
    }

    const previous = pending.current[profile];
    if (previous) window.clearTimeout(previous);
    setStatus('saving');
    pending.current[profile] = window.setTimeout(() => {
      delete pending.current[profile];
      void saveCameraProfile(profile, tuning).then(row => {
        if (editVersion.current[profile] !== version) return;
        dirty.current.delete(profile);
        setSettings(current => mergeCameraRow(current, row));
        setStatus('synced');
        setSyncError('');
      }).catch(error => {
        if (editVersion.current[profile] !== version) return;
        setStatus('error');
        setSyncError(errorMessage(error));
      });
    }, 160);
  }, []);

  const resetProfile = useCallback((profile: CameraProfile) => {
    updateProfile(profile, defaultCameraSettings[profile]);
  }, [updateProfile]);

  return { settings, status, syncError, updateProfile, resetProfile };
}
