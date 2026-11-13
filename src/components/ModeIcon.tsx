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
      return <TrainFront size={size} color={color} strokeWidth={2.2} />;
    case 'metro':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <rect
            x="1.5"
            y="1.5"
            width="13"
            height="13"
            rx="3.2"
            stroke={color ?? 'currentColor'}
            strokeWidth="1.7"
          />
          <path
            d="M4.8 5.2H11.2M8 5.2V11.3"
            stroke={color ?? 'currentColor'}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'ferry':
      return <Ship size={size} color={color} strokeWidth={2.2} />;
    case 'bus':
    default:
      return <Bus size={size} color={color} strokeWidth={2.2} />;
  }
}
