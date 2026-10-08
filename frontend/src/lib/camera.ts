export type CameraProfile = 'desktop' | 'mobile';

export type CameraTuning = {
  horizontal: number;
  vertical: number;
  zoom: number;
};

export type CameraSettings = Record<CameraProfile, CameraTuning>;

export const cameraLimits = {
  horizontal: { min: -0.3, max: 0.3 },
  vertical: { min: -0.3, max: 0.3 },
  zoom: { min: 0.6, max: 1.6 },
} as const;

export const defaultCameraSettings: CameraSettings = {
  desktop: { horizontal: 0, vertical: 0, zoom: 1 },
  mobile: { horizontal: 0.16, vertical: 0.065, zoom: 1 },
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeCameraTuning(value: Partial<CameraTuning> | undefined, fallback: CameraTuning): CameraTuning {
  return {
    horizontal: clamp(value?.horizontal, cameraLimits.horizontal.min, cameraLimits.horizontal.max, fallback.horizontal),
    vertical: clamp(value?.vertical, cameraLimits.vertical.min, cameraLimits.vertical.max, fallback.vertical),
    zoom: clamp(value?.zoom, cameraLimits.zoom.min, cameraLimits.zoom.max, fallback.zoom),
  };
}

export function normalizeCameraSettings(value: Partial<CameraSettings> | undefined): CameraSettings {
  return {
    desktop: normalizeCameraTuning(value?.desktop, defaultCameraSettings.desktop),
    mobile: normalizeCameraTuning(value?.mobile, defaultCameraSettings.mobile),
  };
}
