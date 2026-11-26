import type { RailCategory } from '../types/transit.ts';

export function classifyRailCategory(lineCode: string): RailCategory {
  const code = lineCode.toUpperCase();
  if (code.startsWith('FLY')) return 'airport';
  if (code.startsWith('L')) return 'local';
  if (code.startsWith('F')) return 'long_distance';
  return 'regional';
}
