/**
 * Import one image per floor, trace them, and generate a reference model.
 *
 * The dialog is a workbench rather than a wizard: the floor stack, the images,
 * the outlines and every dimension stay editable side by side, and the model is
 * generated from that state on demand. Reopening it restores the last plan, so
 * a model can be regenerated at a different size without tracing anything
 * again.
 */

import { useMemo, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { usePlanStore, activeLevel, activeLevelIndex } from '@/store/plan-store';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { PROGRAMS, levelHeight, type ProgramId } from '@/core/plan/types';
import {
  buildPlanIdf, planMetrics, validatePlan, zonePerimeter, zoneSidesOf,
} from '@/core/plan/build';
import { bounds, polygonArea } from '@/core/plan/polygon';
import { CLIMATE_LOCATIONS } from '@/core/model/climate';
import type { TraceStrategy } from '@/core/plan/trace';
import { ORIENTATION_LABELS } from '@/core/templates/geometry';
import {
  Button, Select, Input, Badge, Toggle, Field, Separator,
} from '@/components/ui/primitives';
import { formatNumber, cn } from '@/lib/utils';
import { PlanCanvas } from './PlanCanvas';
import { LevelRail } from './LevelRail';
import { NumberField } from '@/components/ui/NumberField';

const STRATEGIES: { id: TraceStrategy; label: string; hint: string }[] = [
  { id: 'outline', label: 'Building outline', hint: 'One footprint around the whole plan.' },
  { id: 'rectangle', label: 'Bounding box', hint: 'A clean rectangle around the plan.' },
  { id: 'rooms', label: 'Rooms', hint: 'A zone per enclosed space between the walls.' },
];

export function PlanImportDialog() {
  const open = usePlanStore((state) => state.open);
  if (!open) return null;
  return <DialogBody />;
}

function DialogBody() {
  const store = usePlanStore();
  const { spec, traceOptions, tool, selectedZoneId, busy, progress, error } = store;
  const level = usePlanStore(activeLevel);
  const levelIndex = usePlanStore(activeLevelIndex);

  const loadGenerated = useModelStore((state) => state.loadGenerated);
  const setView = useUiStore((state) => state.setView);

  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  /** Which gap in the stack the file picker is currently filling. */
  const insertAtRef = useRef<number | undefined>(undefined);

  const pickFloorsAt = (at?: number): void => {
    insertAtRef.current = at;
    addInput.current?.click();
  };
  const [imageOpacity, setImageOpacity] = useState(0.75);
  const [sidesOpen, setSidesOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [creating, setCreating] = useState(false);

  const metrics = useMemo(() => planMetrics(spec), [spec]);
  // Only the open zone's sides are needed, and working them out means walking
  // the whole plan, so it waits until one is actually open.
  const zoneSides = useMemo(
    () => (selectedZoneId ? zoneSidesOf(spec, selectedZoneId) : []),
    [spec, selectedZoneId],
  );
  const issues = useMemo(() => validatePlan(spec), [spec]);
  const blocking = issues.filter((issue) => issue.severity === 'error');
  const hasLevels = spec.levels.length > 0;

  const handleCreate = async (): Promise<void> => {
    if (blocking.length > 0) return;
    setCreating(true);
    try {
      await loadGenerated(spec.name.trim() || 'Traced Plan', buildPlanIdf(spec), spec.locationId);
      store.setOpen(false);
      setView('geometry');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icons.Layers2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Model from floor images</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {progress ?? (hasLevels
                ? `${spec.levels.length} ${spec.levels.length === 1 ? 'floor' : 'floors'} · ${metrics.storeys} storeys · ${level?.image?.name ?? 'no image'}`
                : 'Drop one image per floor to trace and stack')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => store.setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={blocking.length > 0 || creating || !hasLevels}
            onClick={() => void handleCreate()}
          >
            {creating
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Icons.Box className="h-3.5 w-3.5" aria-hidden />}
            Create model
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {hasLevels && <LevelRail onAddAt={(at) => pickFloorsAt(at)} />}

        {/* Canvas */}
        <div
          className="relative min-w-0 flex-1"
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void store.addLevelsFromFiles(event.dataTransfer.files, { at: spec.levels.length });
          }}
        >
          {hasLevels ? <PlanCanvas imageOpacity={imageOpacity} /> : (
            <DropTarget onPick={() => pickFloorsAt()} active={dragOver} busy={busy} />
          )}

          {hasLevels && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
                <ToolButton
                  icon="MousePointer2" label="Select and edit"
                  active={tool === 'select'} onClick={() => store.setTool('select')}
                />
                <ToolButton
                  icon="PenTool" label="Draw a zone"
                  active={tool === 'draw'} onClick={() => store.setTool('draw')}
                />
                <ToolButton
                  icon="Ruler" label="Set this floor's scale"
                  active={tool === 'calibrate'} onClick={() => store.setTool('calibrate')}
                />
                <Separator className="mx-0.5 h-5 w-px" />
                <ToolButton
                  icon="Layers" label="Show the floor below"
                  active={store.showLevelBelow} disabled={levelIndex <= 0}
                  onClick={() => store.setShowLevelBelow(!store.showLevelBelow)}
                />
                <ToolButton
                  icon="Undo2" label="Undo"
                  disabled={store.history.length === 0} onClick={store.undo}
                />
              </div>

              <label className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur">
                <Icons.Image className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <input
                  type="range" min={0} max={1} step={0.05} value={imageOpacity}
                  onChange={(event) => setImageOpacity(Number(event.target.value))}
                  className="h-1 w-24 accent-primary"
                  aria-label="Image opacity"
                />
              </label>
            </div>
          )}

          {store.draft.length > 0 && (
            <div className="pointer-events-auto absolute bottom-14 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-md backdrop-blur">
              <span className="px-1.5 text-xs text-muted-foreground">
                {store.draft.length} {store.draft.length === 1 ? 'corner' : 'corners'}
              </span>
              <Button size="sm" variant="primary" disabled={store.draft.length < 3} onClick={store.commitDraft}>
                Close zone
              </Button>
              <Button size="sm" variant="ghost" onClick={store.cancelDraft}>Discard</Button>
            </div>
          )}

          {busy && progress && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-md backdrop-blur">
                <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                {progress}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && (
              <div className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <Icons.AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {level && (
              <>
                <Section title={level.name} icon="Layers2">
                  <Input
                    value={level.name}
                    onChange={(event) => store.updateLevel(level.id, { name: event.target.value })}
                    aria-label="Floor name"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Floor to floor" hint="Blank follows the building.">
                      <NumberField
                        value={level.heightOverride}
                        onCommit={(heightOverride) => store.updateLevel(level.id, { heightOverride })}
                        min={1.8} max={30} step={0.1} suffix="m"
                        placeholder={String(spec.storeyHeight)}
                      />
                    </Field>
                    <Field label="Identical storeys" hint="Repeats this floor upward.">
                      <NumberField
                        value={level.repeat}
                        onCommit={(value) => store.updateLevel(level.id, {
                          repeat: Math.max(1, Math.round(value ?? 1)),
                        })}
                        min={1} max={60} step={1}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => replaceInput.current?.click()}>
                      <Icons.Upload className="h-3.5 w-3.5" aria-hidden />
                      {level.image ? 'Replace image' : 'Add image'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => store.duplicateLevel(level.id)}>
                      <Icons.Copy className="h-3.5 w-3.5" aria-hidden />
                      Duplicate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => store.removeLevel(level.id)}>
                      <Icons.Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => pickFloorsAt(levelIndex + 1)}>
                      <Icons.ImagePlus className="h-3.5 w-3.5" aria-hidden />
                      Floor above
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => store.addEmptyLevel({ at: levelIndex + 1 })}>
                      <Icons.SquareDashed className="h-3.5 w-3.5" aria-hidden />
                      Blank above
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    A blank floor borrows this one's image and scale, so you can trace or
                    copy its zones without importing the drawing twice.
                  </p>
                </Section>

                <Section title="Alignment" icon="Crosshair">
                  <p className="-mt-1 text-[11px] text-muted-foreground">
                    Where this floor sits over the one below. New floors are registered
                    automatically from their image size.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="East / west">
                      <NumberField
                        value={level.offsetX}
                        onCommit={(value) => store.updateLevel(level.id, { offsetX: value ?? 0 })}
                        step={0.25} suffix="m"
                      />
                    </Field>
                    <Field label="North / south">
                      <NumberField
                        value={level.offsetY}
                        onCommit={(value) => store.updateLevel(level.id, { offsetY: value ?? 0 })}
                        step={0.25} suffix="m"
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm" variant="outline"
                      disabled={levelIndex <= 0 || level.zones.length === 0}
                      onClick={() => store.alignToLevelBelow(level.id)}
                    >
                      <Icons.AlignCenterVertical className="h-3.5 w-3.5" aria-hidden />
                      Centre on floor below
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      disabled={levelIndex <= 0}
                      onClick={store.copyZonesFromBelow}
                    >
                      <Icons.ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                      Copy its zones
                    </Button>
                  </div>
                </Section>

                <Section title="Scale" icon="Ruler">
                  <div className="rounded-md border border-border bg-background p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">Measure on this floor</span>
                      <Button
                        size="sm"
                        variant={tool === 'calibrate' ? 'primary' : 'outline'}
                        disabled={!level.image}
                        onClick={() => store.setTool(tool === 'calibrate' ? 'select' : 'calibrate')}
                      >
                        {level.calibration ? 'Re-measure' : 'Measure'}
                      </Button>
                    </div>
                    {level.calibration ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="shrink-0 text-[11px] text-muted-foreground">is</span>
                        <NumberField
                          value={level.calibration.lengthMetres}
                          onCommit={(value) => value && store.setCalibrationLength(value)}
                          min={0.01} step={0.1} suffix="m" className="w-28"
                        />
                        <span className="text-[11px] text-muted-foreground tabular">
                          {formatNumber(1 / level.metresPerPixelX, 1)} px/m
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Drag along a wall, grid line or scale bar you know the length of.
                      </p>
                    )}
                  </div>

                  <Field label="Whole building" hint="Rescales every floor together; the traces are untouched.">
                    <div className="flex items-center gap-2">
                      <NumberField
                        value={metrics.width || null}
                        onCommit={(value) => store.setExtents(value, null)}
                        min={0.5} step={0.5} suffix="m" className="flex-1"
                      />
                      <Icons.X className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      <NumberField
                        value={metrics.depth || null}
                        onCommit={(value) => store.setExtents(null, value)}
                        min={0.5} step={0.5} suffix="m" className="flex-1"
                      />
                      <button
                        type="button"
                        title={spec.lockAspect ? 'Proportions locked' : 'Width and depth scale independently'}
                        onClick={() => store.updateSpec({ lockAspect: !spec.lockAspect })}
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                          spec.lockAspect
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {spec.lockAspect
                          ? <Icons.Lock className="h-3.5 w-3.5" aria-hidden />
                          : <Icons.Unlock className="h-3.5 w-3.5" aria-hidden />}
                      </button>
                    </div>
                  </Field>
                </Section>

                <Section title="Detect the outline" icon="Wand2">
                  <Field label="What to find">
                    <Select
                      value={traceOptions.strategy}
                      onChange={(event) => store.setTraceOptions({ strategy: event.target.value as TraceStrategy })}
                    >
                      {STRATEGIES.map((strategy) => (
                        <option key={strategy.id} value={strategy.id}>{strategy.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <p className="-mt-1 text-[11px] text-muted-foreground">
                    {STRATEGIES.find((entry) => entry.id === traceOptions.strategy)?.hint}
                  </p>

                  <SliderField
                    label="Ink threshold"
                    value={traceOptions.threshold} min={0.1} max={0.95} step={0.01}
                    display={`${Math.round(traceOptions.threshold * 100)}%`}
                    onChange={(threshold) => store.setTraceOptions({ threshold })}
                  />
                  <SliderField
                    label="Corner detail"
                    value={traceOptions.detail} min={0.002} max={0.05} step={0.002}
                    display={traceOptions.detail < 0.01 ? 'fine' : traceOptions.detail < 0.025 ? 'medium' : 'coarse'}
                    onChange={(detail) => store.setTraceOptions({ detail })}
                  />
                  <Toggle
                    checked={traceOptions.squareUp}
                    onChange={(squareUp) => store.setTraceOptions({ squareUp })}
                    label="Square up the corners"
                  />
                  <Toggle
                    checked={traceOptions.invert}
                    onChange={(invert) => store.setTraceOptions({ invert })}
                    label="Light plan on a dark background"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline" className="flex-1"
                      disabled={!level.image || busy}
                      onClick={() => void store.autoTrace()}
                    >
                      {busy
                        ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        : <Icons.Wand2 className="h-3.5 w-3.5" aria-hidden />}
                      This floor
                    </Button>
                    <Button
                      size="sm" variant="outline" className="flex-1"
                      disabled={busy || spec.levels.length < 2}
                      onClick={() => void store.autoTraceAll()}
                    >
                      <Icons.Layers className="h-3.5 w-3.5" aria-hidden />
                      All floors
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Replaces the zones on the floors it runs over. Draw them by hand with
                    the pen tool when a plan is too noisy to detect.
                  </p>
                </Section>

                <Section title={`Zones on this floor (${level.zones.length})`} icon="LayoutGrid">
                  {level.zones.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No outline yet. Detect one above, draw it with the pen tool, or copy
                      the floor below.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {level.zones.map((zone) => {
                        const isSelected = zone.id === selectedZoneId;
                        const box = bounds(zone.points);
                        const area = polygonArea(zone.points)
                          * level.metresPerPixelX * level.metresPerPixelY;
                        // What a side inherits when it carries no figure of its own.
                        const zoneGlazing = zone.windowToWallRatio ?? spec.windowToWallRatio;
                        return (
                          <li key={zone.id} className={cn(
                            'rounded-md border transition-colors',
                            isSelected ? 'border-primary bg-accent/40' : 'border-border',
                          )}>
                            <button
                              type="button"
                              onClick={() => store.selectZone(isSelected ? null : zone.id)}
                              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                            >
                              <span
                                className="h-3 w-3 shrink-0 rounded-sm"
                                style={{ backgroundColor: `hsl(${zone.hue}, 72%, 50%)` }}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium">{zone.name}</span>
                              <span className="shrink-0 text-[11px] text-muted-foreground tabular">
                                {formatNumber(area, area < 100 ? 1 : 0)} m²
                              </span>
                              <Icons.ChevronDown className={cn(
                                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                isSelected && 'rotate-180',
                              )} aria-hidden />
                            </button>

                            {isSelected && (
                              <div className="space-y-2.5 border-t border-border px-2.5 py-2.5">
                                <Input
                                  value={zone.name}
                                  onChange={(event) => store.updateZone(zone.id, { name: event.target.value })}
                                  aria-label="Zone name"
                                />
                                <Field label="Footprint size" hint="Resizes this zone about its own centre.">
                                  <div className="flex items-center gap-2">
                                    <NumberField
                                      value={box.width * level.metresPerPixelX}
                                      onCommit={(value) => store.setZoneExtents(zone.id, value, null)}
                                      min={0.5} step={0.5} suffix="m" className="flex-1"
                                    />
                                    <Icons.X className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                                    <NumberField
                                      value={box.depth * level.metresPerPixelY}
                                      onCommit={(value) => store.setZoneExtents(zone.id, null, value)}
                                      min={0.5} step={0.5} suffix="m" className="flex-1"
                                    />
                                  </div>
                                </Field>
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="field-label">Glazing</span>
                                    {zoneSides.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => setSidesOpen(!sidesOpen)}
                                        className={cn(
                                          'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
                                          sidesOpen
                                            ? 'bg-accent text-accent-foreground'
                                            : 'text-muted-foreground hover:text-foreground',
                                        )}
                                      >
                                        <Icons.ChevronRight
                                          className={cn('h-3 w-3 transition-transform', sidesOpen && 'rotate-90')}
                                          aria-hidden
                                        />
                                        By side
                                      </button>
                                    )}
                                  </div>
                                  <NumberField
                                    value={zone.windowToWallRatio === null ? null : zone.windowToWallRatio * 100}
                                    onCommit={(value) => store.updateZone(zone.id, {
                                      windowToWallRatio: value === null ? null : value / 100,
                                    })}
                                    min={0} max={95} step={1} suffix="%"
                                    placeholder={String(Math.round(spec.windowToWallRatio * 100))}
                                  />
                                  {sidesOpen && zoneSides.length > 1 && (
                                    <div className="space-y-1 pl-3.5">
                                      {zoneSides.map((side) => {
                                        const override = zone.windowToWallRatioBySide?.[side.orientation];
                                        return (
                                          <div key={side.orientation} className="flex items-center gap-2">
                                            <span
                                              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                                              title={`${formatNumber(side.wallArea, 1)} m² of wall per storey`}
                                            >
                                              {ORIENTATION_LABELS[side.orientation]}
                                            </span>
                                            <NumberField
                                              value={override === undefined ? null : override * 100}
                                              onCommit={(value) => store.setZoneSideGlazing(
                                                zone.id, side.orientation,
                                                value === null ? null : value / 100,
                                              )}
                                              min={0} max={95} step={1} suffix="%"
                                              placeholder={String(Math.round(zoneGlazing * 100))}
                                              className="w-24 shrink-0"
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <p className="text-[11px] text-muted-foreground">
                                    {sidesOpen && zoneSides.length > 1
                                      ? 'Blank follows this zone.'
                                      : 'Blank follows the building setting.'}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>{zone.points.length} corners</span>
                                  <span className="tabular">
                                    {formatNumber(zonePerimeter(level, zone), 1)} m perimeter
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button size="sm" variant="outline" onClick={store.simplifySelected}>
                                    <Icons.Spline className="h-3.5 w-3.5" aria-hidden />
                                    Simplify
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={store.squareUpSelected}>
                                    <Icons.Square className="h-3.5 w-3.5" aria-hidden />
                                    Square up
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => store.duplicateZone(zone.id)}>
                                    <Icons.Copy className="h-3.5 w-3.5" aria-hidden />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => store.removeZone(zone.id)}>
                                    <Icons.Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {level.zones.length > 0 && (
                    <Button size="sm" variant="ghost" className="w-full" onClick={store.clearZones}>
                      Clear this floor
                    </Button>
                  )}
                </Section>
              </>
            )}

            <Section title="Building" icon="Building2">
              <Field label="Model name">
                <Input
                  value={spec.name}
                  onChange={(event) => store.updateSpec({ name: event.target.value })}
                />
              </Field>
              <Field label="Use" hint="Sets schedules, loads and default glazing.">
                <Select
                  value={spec.program}
                  onChange={(event) => store.setProgram(event.target.value as ProgramId)}
                >
                  {PROGRAMS.map((program) => (
                    <option key={program.id} value={program.id}>{program.label}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Floor to floor" hint="Default for floors without one.">
                  <NumberField
                    value={spec.storeyHeight}
                    onCommit={(value) => store.updateSpec({ storeyHeight: value ?? 3 })}
                    min={1.8} max={30} step={0.1} suffix="m"
                  />
                </Field>
                <Field label="North axis" hint="Rotation of the plan from true north.">
                  <NumberField
                    value={spec.northAxis}
                    onCommit={(value) => store.updateSpec({ northAxis: value ?? 0 })}
                    min={-180} max={360} step={5} suffix="°"
                  />
                </Field>
              </div>
              <Field label="Glazing">
                <NumberField
                  value={spec.windowToWallRatio * 100}
                  onCommit={(value) => store.updateSpec({ windowToWallRatio: (value ?? 30) / 100 })}
                  min={0} max={95} step={1} suffix="%"
                />
              </Field>
              <Field label="Location">
                <Select
                  value={spec.locationId}
                  onChange={(event) => store.updateSpec({ locationId: event.target.value })}
                >
                  {CLIMATE_LOCATIONS.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.city} ({location.zone})
                    </option>
                  ))}
                </Select>
              </Field>
              {hasLevels && (
                <Button size="sm" variant="ghost" className="w-full"
                  onClick={() => void store.clearPlanEntirely()}>
                  Start over
                </Button>
              )}
            </Section>
          </div>

          {/* Summary */}
          <div className="shrink-0 border-t border-border bg-background/60 p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <Readout label="Ground floor" value={`${formatNumber(metrics.footprintArea, 0)} m²`} />
              <Readout label="Total floor area" value={`${formatNumber(metrics.floorArea, 0)} m²`} />
              <Readout label="Extents" value={`${formatNumber(metrics.width, 1)} × ${formatNumber(metrics.depth, 1)} m`} />
              <Readout label="Height" value={`${formatNumber(metrics.buildingHeight, 1)} m`} />
              <Readout label="Storeys" value={String(metrics.storeys)} />
              <Readout label="Thermal zones" value={String(metrics.zoneCount)} />
            </div>
            {level && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {level.name} sits {formatNumber(levelHeight(spec, level), 1)} m floor to floor.
              </p>
            )}
            {issues.length > 0 && (
              <ul className="mt-2 space-y-1">
                {issues.slice(0, 4).map((issue, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-[11px]">
                    <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>
                      {issue.severity === 'error' ? 'Fix' : 'Check'}
                    </Badge>
                    <span className="text-muted-foreground">{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            void store.addLevelsFromFiles(event.target.files, { at: insertAtRef.current });
          }
          insertAtRef.current = undefined;
          event.target.value = '';
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && level) void store.replaceLevelImage(level.id, file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ fragments

function DropTarget({ onPick, active, busy }: {
  onPick: () => void; active: boolean; busy: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <button
        type="button"
        onClick={onPick}
        className={cn(
          'flex h-full max-h-96 w-full max-w-xl flex-col items-center justify-center gap-3',
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          active ? 'border-primary bg-accent/40' : 'border-border hover:border-primary hover:bg-accent/20',
        )}
      >
        {busy
          ? <Icons.Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
          : <Icons.ImagePlus className="h-8 w-8 text-muted-foreground" aria-hidden />}
        <div>
          <p className="text-sm font-medium">Drop one image per floor</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Floor plans, site plans, satellite screenshots or sketches. Each becomes a
            level, traced and stacked in filename order — so drop them all at once.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PNG, JPEG, WebP and SVG, up to 12 MB each.
          </p>
        </div>
        <span className="text-xs text-primary">or choose files</span>
      </button>
    </div>
  );
}

function Section({ title, icon, children }: {
  title: string; icon: keyof typeof Icons; children: React.ReactNode;
}) {
  const Icon = Icons[icon] as React.ComponentType<{ className?: string }>;
  return (
    <section className="border-b border-border p-3">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="truncate">{title}</span>
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function ToolButton({ icon, label, active, disabled, onClick }: {
  icon: keyof typeof Icons; label: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  const Icon = Icons[icon] as React.ComponentType<{ className?: string }>;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function SliderField({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground tabular">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full accent-primary"
      />
    </label>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular">{value}</span>
    </div>
  );
}
