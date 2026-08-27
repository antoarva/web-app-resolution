import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useSimulationStore } from '@/store/simulation-store';
import { useUiStore } from '@/store/ui-store';
import { formatArea, formatDuration, cn } from '@/lib/utils';

/** Compact footer: model size, parse cost, engine state and issue counts. */
export function StatusBar() {
  const building = useModelStore((state) => state.building);
  const objectCount = useModelStore((state) => state.model.objects.length);
  const issues = useModelStore((state) => state.issues);
  const parseTimeMs = useModelStore((state) => state.parseTimeMs);
  const setView = useUiStore((state) => state.setView);

  const engineLoaded = useSimulationStore((state) => state.engineLoaded);
  const engineVersion = useSimulationStore((state) => state.engineVersion);
  const runTimeMs = useSimulationStore((state) => state.runTimeMs);
  const status = useSimulationStore((state) => state.status);

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setView('explorer')}
        className="flex items-center gap-1 hover:text-foreground"
      >
        <Icons.Boxes className="h-3 w-3" aria-hidden />
        <span className="tabular">{objectCount}</span> objects
      </button>

      {building && (
        <>
          <span className="tabular">{building.zones.length} zones</span>
          <span className="tabular">{formatArea(building.totals.floorArea)}</span>
          <span className="tabular">{(building.totals.windowToWallRatio * 100).toFixed(0)}% WWR</span>
        </>
      )}

      {(errors > 0 || warnings > 0) && (
        <button
          type="button"
          onClick={() => setView('editor')}
          className="flex items-center gap-2 hover:text-foreground"
        >
          {errors > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <Icons.XCircle className="h-3 w-3" aria-hidden />
              <span className="tabular">{errors}</span>
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <Icons.AlertTriangle className="h-3 w-3" aria-hidden />
              <span className="tabular">{warnings}</span>
            </span>
          )}
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {parseTimeMs > 0 && <span className="tabular">parse {formatDuration(parseTimeMs)}</span>}
        {runTimeMs > 0 && status === 'complete' && (
          <span className="tabular">run {formatDuration(runTimeMs)}</span>
        )}
        <span className="flex items-center gap-1">
          <Icons.Cpu className={cn('h-3 w-3', engineLoaded ? 'text-success' : '')} aria-hidden />
          {engineLoaded ? `wasm ${engineVersion}` : 'wasm idle'}
        </span>
      </div>
    </footer>
  );
}
