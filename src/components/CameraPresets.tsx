import { Compass } from 'lucide-react';
import { OSLO_CAMERA_PRESETS, type CameraPreset } from './transitTheme.ts';

interface CameraPresetsProps {
  activePresetId: string | null;
  onSelectPreset: (preset: CameraPreset) => void;
}

export function CameraPresets({ activePresetId, onSelectPreset }: CameraPresetsProps) {
  return (
    <nav className="glass-panel camera-presets" aria-label="Oslo camera presets">
      <span className="preset-label">
        <Compass size={13} />
        Oslo
      </span>
      {OSLO_CAMERA_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`preset-btn${activePresetId === preset.id ? ' active' : ''}`}
          onClick={() => onSelectPreset(preset)}
        >
          {preset.label}
        </button>
      ))}
    </nav>
  );
}
