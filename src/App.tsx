import { useEffect, useRef, useState } from 'react';
import type { MapView, TransitMode } from './types/transit.ts';
import { MODE_ORDER } from './components/transitTheme.ts';
import { ScooterView } from './components/ScooterView.tsx';
import { TransitView } from './components/TransitView.tsx';
import { ViewDock } from './components/ViewDock.tsx';
import type { TransitCamera } from './components/TransitMap.tsx';
import { useLayerPreferences } from './hooks/useLocalLayers.ts';

const VIEWS: readonly MapView[] = ['all', ...MODE_ORDER, 'scooter'];

const SHORTCUTS = new Map(VIEWS.map((view, index) => [String(index + 1), view]));

function readInitialUrlState(): { mode: MapView; query: string } {
  if (typeof window === 'undefined') return { mode: 'all', query: '' };
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode') ?? 'all';
  const mode = VIEWS.find(view => view === rawMode) ?? 'all';
  const query = params.get('q') ?? '';
  return { mode, query };
}

export function App() {
  const [initialUrlState] = useState(readInitialUrlState);
  const [view, setView] = useState(initialUrlState.mode);
  const previousTransit = useRef<TransitMode | 'all'>('all');
  const savedCamera = useRef<TransitCamera | null>(null);
  const preferences = useLayerPreferences();
  const [searchQuery, setSearchQuery] = useState(initialUrlState.query);
  const changeView = (next: MapView) => {
    if (view !== 'scooter') previousTransit.current = view;
    setView(next);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, select, textarea')))) return;
      const next = SHORTCUTS.get(event.key);
      if (next) changeView(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'all') url.searchParams.delete('mode');
    else url.searchParams.set('mode', view);
    if (view === 'scooter' || !searchQuery.trim()) url.searchParams.delete('q');
    else url.searchParams.set('q', searchQuery);
    window.history.replaceState(null, '', url);
  }, [view, searchQuery]);

  if (view === 'scooter') return (
    <main className="app-shell scooter-view">
      <ScooterView />
      <ViewDock selectedMode={view} onSelectMode={changeView} previousTransit={previousTransit.current} stats={null} />
    </main>
  );
  return <TransitView selectedMode={view} setSelectedMode={changeView} searchQuery={searchQuery}
    setSearchQuery={setSearchQuery} savedCamera={savedCamera} preferences={preferences} />;
}

export default App;
