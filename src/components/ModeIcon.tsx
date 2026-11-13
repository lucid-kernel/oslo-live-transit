import { Bus, Ship, TrainFront, TramFront } from 'lucide-react';
import type { TransitMode } from '../types/transit.ts';

interface ModeIconProps {
  mode: TransitMode;
  size?: number;
  color?: string;
}

export function ModeIcon({ mode, size = 14, color }: ModeIconProps) {
  switch (mode) {
    case 'tram':
      return <TramFront size={size} color={color} strokeWidth={2.2} />;
    case 'train':
    case 'metro':
      return <TrainFront size={size} color={color} strokeWidth={2.2} />;
    case 'ferry':
      return <Ship size={size} color={color} strokeWidth={2.2} />;
    case 'bus':
    default:
      return <Bus size={size} color={color} strokeWidth={2.2} />;
  }
}
