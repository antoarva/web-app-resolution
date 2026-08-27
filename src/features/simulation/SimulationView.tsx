import { useEffect, useMemo, useRef } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useSimulationStore } from '@/store/simulation-store';
import { useUiStore } from '@/store/ui-store';
import { simulationBlockers } from '@/core/model/simulation-input';
import { Button, ProgressBar, Select, Field, StatTile } from '@/components/ui/primitives';
import { SCHEDULE_KIND } from '@/wasm/protocol';
import { formatDuration, formatNumber, cn } from '@/lib/utils';

/** Configure and launch a run, and watch the engine work. */
export function SimulationView() {
  const model = useModelStore((state) => state.model);
  const building = useModelStore((state) => state.building);

  const status = useSimulationStore((state) => state.status);
  const engineLoaded = useSimulationStore((state) => state.engineLoaded);
  const engineVersion = useSimulationStore((state) => state.engineVersion);
  const error = useSimulationStore((state) => state.error);
  const result = useSimulationStore((state) => state.result);
  const runTimeMs = useSimulationStore((state) => state.runTimeMs);
  const consoleLines = useSimulationStore((state) => state.console);
  const options = useSimulationStore((state) => state.options);
  const location = useSimulationStore((state) => state.location);
  const run = useSimulationStore((state) => state.run);
  const setOptions = useSimulationStore((state) => state.setOptions);
  const loadEngineModule = useSimulationStore((state) => state.loadEngineModule);
  const clearConsole = useSimulationStore((state) => state.clearConsole);

  const setView = useUiStore((state) => state.setView);
  const consoleEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engineLoaded) void loadEngineModule();
  }, [engineLoaded, loadEngineModule]);

  // Keep the newest console line in view.
  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ block: 'end' });
  }, [consoleLines.length]);

  const blockers = useMemo(() => (building ? simulationBlockers(building) : ['No model loaded.']), [building]);
  const running = status === 'running' || status === 'loading-engine';
  const canRun = blockers.length === 0 && !running;

  const handleRun = async (): Promise<void> => {
    if (!building) return;
    await run(model, building);
  };

  const surfaceCount = useMemo(() => {
    if (!building) return 0;
    return building.zones.reduce(
      (total, zone) => total + zone.surfaces.length
        + zone.surfaces.reduce((inner, surface) => inner + surface.children.length, 0),
      0,
    );
  }, [building]);

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
        <div className="panel-header">
          <Icons.Settings2 className="h-3.5 w-3.5" aria-hidden />
          Run settings
        </div>

        <div className="space-y-4 overflow-y-auto p-3">
          <Field label="Run period" hint="Shorter runs finish faster while you iterate.">
            <Select
              value={String(options.numDays ?? 365)}
              onChange={(event) => setOptions({ numDays: Number(event.target.value) })}
              className="text-xs"
            >
              <option value="365">Full year (365 days)</option>
              <option value="181">Half year (181 days)</option>
              <option value="90">Winter quarter (90 days)</option>
              <option value="31">One month (31 days)</option>
              <option value="7">One week</option>
            </Select>
          </Field>

          <Field label="Start day" hint="Day of year the run begins.">
            <Select
              value={String(options.startDay ?? 1)}
              onChange={(event) => setOptions({ startDay: Number(event.target.value) })}
              className="text-xs"
            >
              <option value="1">1 January</option>
              <option value="91">1 April</option>
              <option value="182">1 July</option>
              <option value="274">1 October</option>
            </Select>
          </Field>

          <Field label="Timesteps per hour" hint="More timesteps improve stability at some cost.">
            <Select
              value={String(options.timestepsPerHour ?? 4)}
              onChange={(event) => setOptions({ timestepsPerHour: Number(event.target.value) })}
              className="text-xs"
            >
              <option value="1">1 — coarse</option>
              <option value="2">2</option>
              <option value="4">4 — default</option>
              <option value="6">6</option>
              <option value="12">12 — fine</option>
            </Select>
          </Field>

          <Field label="Operating pattern" hint="Drives internal gains and setback hours.">
            <Select
              value={String(options.scheduleKind ?? SCHEDULE_KIND.office)}
              onChange={(event) => setOptions({ scheduleKind: Number(event.target.value) })}
              className="text-xs"
            >
              <option value={SCHEDULE_KIND.office}>Office hours</option>
              <option value={SCHEDULE_KIND.residential}>Residential</option>
              <option value={SCHEDULE_KIND.continuous}>Continuous (24/7)</option>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Heating setpoint">
              <Select
                value={String(options.heatingSetpoint ?? 20)}
                onChange={(event) => setOptions({ heatingSetpoint: Number(event.target.value) })}
                className="text-xs"
              >
                {[18, 19, 20, 21, 22].map((value) => (
                  <option key={value} value={value}>{value} °C</option>
                ))}
              </Select>
            </Field>
            <Field label="Cooling setpoint">
              <Select
                value={String(options.coolingSetpoint ?? 24)}
                onChange={(event) => setOptions({ coolingSetpoint: Number(event.target.value) })}
                className="text-xs"
              >
                {[23, 24, 25, 26, 27].map((value) => (
                  <option key={value} value={value}>{value} °C</option>
                ))}
              </Select>
            </Field>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full justify-center"
            disabled={!canRun}
            onClick={() => void handleRun()}
          >
            {running
              ? <><Icons.Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Running…</>
              : <><Icons.Play className="h-4 w-4" aria-hidden /> Run simulation</>}
          </Button>

          {blockers.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <Icons.XCircle className="h-3.5 w-3.5" aria-hidden />
                Cannot run yet
              </div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border p-4">
          <div className="flex items-center gap-3">
            <StatusIndicator status={status} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {status === 'complete' ? 'Run complete'
                  : status === 'running' ? 'Solving heat balance…'
                    : status === 'loading-engine' ? 'Loading WebAssembly engine…'
                      : status === 'error' ? 'Run failed'
                        : engineLoaded ? 'Engine ready' : 'Engine not loaded'}
              </div>
              <div className="text-xs text-muted-foreground">
                {status === 'complete' && result
                  ? `${result.hours.toLocaleString()} hours across ${result.zoneCount} zone${result.zoneCount === 1 ? '' : 's'} in ${formatDuration(runTimeMs)}`
                  : error ?? `WebAssembly engine ${engineVersion}`}
              </div>
            </div>
            {status === 'complete' && (
              <Button variant="primary" size="sm" onClick={() => setView('results')}>
                <Icons.BarChart3 className="h-3.5 w-3.5" aria-hidden />
                View results
              </Button>
            )}
          </div>

          {running && <ProgressBar value={status === 'loading-engine' ? 0.15 : 0.6} className="mt-3" />}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4">
          <StatTile label="Zones" value={String(building?.zones.length ?? 0)} />
          <StatTile label="Surfaces" value={String(surfaceCount)} detail="including openings" />
          <StatTile
            label="Simulated hours"
            value={((options.numDays ?? 365) * 24).toLocaleString()}
            detail={`${options.timestepsPerHour ?? 4}× substeps`}
          />
          <StatTile
            label="Site"
            value={location?.city ?? '—'}
            detail={location ? `ASHRAE ${location.zone}` : 'set on the Weather view'}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="panel-header">
            <Icons.Terminal className="h-3.5 w-3.5" aria-hidden />
            Engine output
            <div className="ml-auto">
              <Button variant="ghost" size="sm" onClick={clearConsole}>
                <Icons.Eraser className="h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
            {consoleLines.length === 0 && (
              <div className="text-muted-foreground">No output yet. Run a simulation to see engine messages here.</div>
            )}
            {consoleLines.map((line, index) => (
              <div key={index} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground/60">
                  {new Date(line.time).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span className={cn(
                  'shrink-0 uppercase',
                  line.level === 'error' ? 'text-destructive'
                    : line.level === 'warning' ? 'text-warning'
                      : line.level === 'success' ? 'text-success' : 'text-info',
                )}>
                  {line.level.padEnd(7)}
                </span>
                <span className="min-w-0 break-words">{line.text}</span>
              </div>
            ))}
            <div ref={consoleEnd} />
          </div>
        </div>

        {result && (
          <div className="shrink-0 border-t border-border p-3">
            <div className="field-label mb-2">Per-zone results</div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Zone</th>
                    <th className="px-3 py-1.5 text-right font-medium">Heating</th>
                    <th className="px-3 py-1.5 text-right font-medium">Cooling</th>
                    <th className="px-3 py-1.5 text-right font-medium">Peak heat</th>
                    <th className="px-3 py-1.5 text-right font-medium">Peak cool</th>
                    <th className="px-3 py-1.5 text-right font-medium">Temp range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.zoneSummaries.map((summary, index) => (
                    <tr key={index} className="hover:bg-accent/30">
                      <td className="px-3 py-1.5 font-medium">
                        {useSimulationStore.getState().zoneNames[index] ?? `Zone ${index + 1}`}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{formatNumber(summary.heatingKWh, 0)} kWh</td>
                      <td className="px-3 py-1.5 text-right tabular">{formatNumber(summary.coolingKWh, 0)} kWh</td>
                      <td className="px-3 py-1.5 text-right tabular">{formatNumber(summary.peakHeatingW / 1000, 1)} kW</td>
                      <td className="px-3 py-1.5 text-right tabular">{formatNumber(summary.peakCoolingW / 1000, 1)} kW</td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {formatNumber(summary.minTemp, 1)}–{formatNumber(summary.maxTemp, 1)} °C
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const config: Record<string, { icon: typeof Icons.Circle; className: string }> = {
    idle: { icon: Icons.Circle, className: 'text-muted-foreground' },
    'loading-engine': { icon: Icons.Loader2, className: 'text-info animate-spin' },
    ready: { icon: Icons.CheckCircle2, className: 'text-success' },
    running: { icon: Icons.Loader2, className: 'text-primary animate-spin' },
    complete: { icon: Icons.CheckCircle2, className: 'text-success' },
    error: { icon: Icons.XCircle, className: 'text-destructive' },
  };
  const entry = config[status] ?? config.idle;
  const Icon = entry.icon;

  return (
    <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
      <Icon className={cn('h-5 w-5', entry.className)} aria-hidden />
      {status === 'running' && (
        <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-primary" />
      )}
    </div>
  );
}
