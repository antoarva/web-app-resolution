import { useEffect, lazy, Suspense } from 'react';
import * as Icons from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { ErrorBoundary } from './ErrorBoundary';
import { useUiStore, type ViewId } from '@/store/ui-store';
import { useModelStore } from '@/store/model-store';
import { useSimulationStore } from '@/store/simulation-store';
import { usePlanStore } from '@/store/plan-store';
import { DEFAULT_TEMPLATE_ID } from '@/core/templates/buildings';
import { requestPersistentStorage } from '@/lib/persistence';
import { NAV_ITEMS } from './navigation';

// Heavy views load on demand so first paint is not blocked by Three or Monaco.
const DashboardView = lazy(() => import('@/features/docs/DashboardView').then((m) => ({ default: m.DashboardView })));
const GeometryView = lazy(() => import('@/features/geometry/GeometryView').then((m) => ({ default: m.GeometryView })));
const EditorView = lazy(() => import('@/features/editor/EditorView').then((m) => ({ default: m.EditorView })));
const ExplorerView = lazy(() => import('@/features/explorer/ExplorerView').then((m) => ({ default: m.ExplorerView })));
const ConstructionsView = lazy(() => import('@/features/constructions/ConstructionsView').then((m) => ({ default: m.ConstructionsView })));
const SchedulesView = lazy(() => import('@/features/schedules/SchedulesView').then((m) => ({ default: m.SchedulesView })));
const HvacView = lazy(() => import('@/features/hvac/HvacView').then((m) => ({ default: m.HvacView })));
const WeatherView = lazy(() => import('@/features/weather/WeatherView').then((m) => ({ default: m.WeatherView })));
const SimulationView = lazy(() => import('@/features/simulation/SimulationView').then((m) => ({ default: m.SimulationView })));
const ResultsView = lazy(() => import('@/features/results/ResultsView').then((m) => ({ default: m.ResultsView })));
const DocsView = lazy(() => import('@/features/docs/DocsView').then((m) => ({ default: m.DocsView })));

// The plan importer is a full-screen overlay rather than a view, so it is
// mounted beside the router and only fetched once someone opens it.
const PlanImportDialog = lazy(() => import('@/features/geometry/plan-import/PlanImportDialog').then((m) => ({ default: m.PlanImportDialog })));

const VIEWS: Record<ViewId, React.ComponentType> = {
  dashboard: DashboardView,
  geometry: GeometryView,
  editor: EditorView,
  explorer: ExplorerView,
  constructions: ConstructionsView,
  schedules: SchedulesView,
  hvac: HvacView,
  weather: WeatherView,
  simulation: SimulationView,
  results: ResultsView,
  docs: DocsView,
};

export function App() {
  const view = useUiStore((state) => state.view);
  const hydrated = useUiStore((state) => state.hydrated);
  const hydrate = useUiStore((state) => state.hydrate);
  const setView = useUiStore((state) => state.setView);

  const source = useModelStore((state) => state.source);
  const loadTemplate = useModelStore((state) => state.loadTemplate);
  const planImportOpen = usePlanStore((state) => state.open);

  // Boot: restore preferences, warm the engine, seed a model, keep data around.
  useEffect(() => {
    void hydrate();
    void useSimulationStore.getState().loadEngineModule();
    void requestPersistentStorage();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && source === '') void loadTemplate(DEFAULT_TEMPLATE_ID);
  }, [hydrated, source, loadTemplate]);

  // Number keys jump between views, matching the shortcuts shown in the sidebar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The importer owns the keyboard while it is up.
      if (usePlanStore.getState().open) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;

      const match = NAV_ITEMS.find((item) => item.shortcut === event.key);
      if (match) {
        event.preventDefault();
        setView(match.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView]);

  const ActiveView = VIEWS[view];

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary resetKey={view}>
            <Suspense fallback={<ViewLoading />}>
              <ActiveView />
            </Suspense>
          </ErrorBoundary>
        </main>
        <StatusBar />
      </div>

      {planImportOpen && (
        <Suspense fallback={null}>
          <PlanImportDialog />
        </Suspense>
      )}
    </div>
  );
}

function ViewLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Icons.Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Loading view…
    </div>
  );
}
