/**
 * Building specifications, editable in place.
 *
 * The values shown are measured from the model each render rather than being
 * remembered here, so they stay honest after an edit made anywhere else — the
 * text editor, the object forms, a fresh template. That also makes every field
 * an absolute target: typing the old number back restores the old geometry.
 */

import { Fragment, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import {
  measureGeometry, type GeometryEdit, type GlazingGroup, type GlazingScope,
} from '@/core/model/transform';
import { Field } from '@/components/ui/primitives';
import { NumberField } from '@/components/ui/NumberField';
import { formatArea, formatNumber, cn } from '@/lib/utils';

type GlazingBreakdown = 'building' | 'side' | 'zone';

const BREAKDOWNS: { id: GlazingBreakdown; label: string }[] = [
  { id: 'building', label: 'All' },
  { id: 'side', label: 'Side' },
  { id: 'zone', label: 'Zone' },
];

/** Ratios are stored 0-1 and shown as whole percentages with one decimal. */
function percent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

/** Identifies a group across re-measurements, for remembering what is open. */
function keyOf(scope: GlazingScope): string {
  switch (scope.kind) {
    case 'building': return 'building';
    case 'side': return `side:${scope.orientation}`;
    case 'zone': return `zone:${scope.zone.toLowerCase()}`;
    case 'surface': return `surface:${scope.name.toLowerCase()}`;
    default: return `zone-side:${scope.zone.toLowerCase()}:${scope.orientation}`;
  }
}

/**
 * One glazing target. A group with no windows has nothing to resize, so its
 * field is held open but inert rather than quietly doing nothing.
 */
function GlazingRow({ group, onCommit, showLabel, indent, expandable, open, onToggle }: {
  group: GlazingGroup;
  onCommit: (scope: GlazingScope, ratio: number) => void;
  showLabel?: boolean;
  indent?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const empty = group.windowCount === 0;
  return (
    <div className={cn('flex items-center gap-1.5', indent && 'pl-3.5')}>
      {showLabel && (expandable ? (
        <button
          type="button"
          onClick={onToggle}
          title={open ? 'Hide the walls behind this' : 'Show each side on its own'}
          className="shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <Icons.ChevronRight
            className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        </button>
      ) : <span className="w-3 shrink-0" aria-hidden />)}
      {showLabel && (
        <span
          className={cn('min-w-0 flex-1 truncate text-xs', indent && 'text-muted-foreground')}
          title={`${group.label} · ${formatArea(group.wallArea)} of wall`}
        >
          {group.label}
        </span>
      )}
      <NumberField
        value={empty ? null : percent(group.windowToWallRatio)}
        onCommit={(value) => {
          if (value !== null) onCommit(group.scope, value / 100);
        }}
        min={0} max={95} step={1} suffix="%"
        disabled={empty}
        placeholder={empty ? 'none' : undefined}
        className={showLabel ? 'w-24 shrink-0' : undefined}
      />
    </div>
  );
}

/** A breakdown, with each row able to open onto the walls underneath it. */
function GlazingList({ groups, expanded, onToggle, onCommit }: {
  groups: GlazingGroup[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onCommit: (scope: GlazingScope, ratio: number) => void;
}) {
  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const key = keyOf(group.scope);
        const children = group.children ?? [];
        // Splitting a group into a single child would just repeat the row.
        const expandable = children.length > 1;
        const open = expandable && expanded.has(key);
        return (
          <Fragment key={key}>
            <GlazingRow
              group={group} onCommit={onCommit} showLabel
              expandable={expandable} open={open} onToggle={() => onToggle(key)}
            />
            {open && children.map((child) => (
              <GlazingRow key={keyOf(child.scope)} group={child} onCommit={onCommit} showLabel indent />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

export function GeometrySpecPanel() {
  const building = useModelStore((state) => state.building);
  const model = useModelStore((state) => state.model);
  const busy = useModelStore((state) => state.busy);
  const editGeometry = useModelStore((state) => state.editGeometry);

  const [open, setOpen] = useState(true);
  const [lockAspect, setLockAspect] = useState(false);
  const [glazingBy, setGlazingBy] = useState<GlazingBreakdown>('building');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState<string[]>([]);

  const spec = useMemo(
    () => (building ? measureGeometry(model, building) : null),
    [model, building],
  );
  if (!spec) return null;

  const apply = (edit: GeometryEdit): void => {
    void editGeometry(edit).then(setNotes);
  };

  // With proportions locked, the other side follows by the same factor, which
  // is what keeps a traced outline's shape while resizing it.
  const setWidth = (value: number | null): void => {
    if (value === null || spec.width <= 0) return;
    apply(lockAspect
      ? { width: value, depth: spec.depth * (value / spec.width) }
      : { width: value });
  };

  const setDepth = (value: number | null): void => {
    if (value === null || spec.depth <= 0) return;
    apply(lockAspect
      ? { depth: value, width: spec.width * (value / spec.depth) }
      : { depth: value });
  };

  const setGlazing = (scope: GlazingScope, ratio: number): void => {
    apply({ glazing: [{ scope, ratio }] });
  };

  const breakdown = glazingBy === 'side' ? spec.glazing.sides
    : glazingBy === 'zone' ? spec.glazing.zones : [];

  const toggleRow = (key: string): void => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };

  const perStorey = spec.storeyHeight !== null;

  return (
    <div className="shrink-0 border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="panel-header flex w-full items-center gap-1.5 hover:text-foreground"
      >
        <Icons.Ruler className="h-3.5 w-3.5" aria-hidden />
        <span className="flex-1 text-left">Dimensions</span>
        <Icons.ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
      </button>

      {open && (
        <div className={cn('space-y-3 p-3', busy && 'pointer-events-none opacity-60')}>
          <Field label="Footprint" hint="Rescales the model about its lowest south-west corner.">
            <div className="flex items-center gap-2">
              <NumberField
                value={spec.width || null}
                onCommit={setWidth}
                min={0.5} step={0.5} suffix="m" className="flex-1"
              />
              <Icons.X className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <NumberField
                value={spec.depth || null}
                onCommit={setDepth}
                min={0.5} step={0.5} suffix="m" className="flex-1"
              />
              <button
                type="button"
                title={lockAspect ? 'Proportions locked' : 'Width and depth scale independently'}
                aria-pressed={lockAspect}
                onClick={() => setLockAspect(!lockAspect)}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
                  lockAspect
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {lockAspect
                  ? <Icons.Lock className="h-3.5 w-3.5" aria-hidden />
                  : <Icons.Unlock className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field
              label={perStorey ? 'Floor to floor' : 'Total height'}
              hint={perStorey
                ? `${spec.storeys} storey${spec.storeys === 1 ? '' : 's'}`
                : 'Storeys are unevenly stacked.'}
            >
              <NumberField
                value={(perStorey ? spec.storeyHeight : spec.height) || null}
                onCommit={(value) => {
                  if (value === null) return;
                  apply({ height: perStorey ? value * spec.storeys : value });
                }}
                min={0.5} step={0.1} suffix="m"
              />
            </Field>
            <Field label="North axis" hint="Rotation from true north.">
              <NumberField
                value={spec.northAxis}
                onCommit={(value) => apply({ northAxis: value ?? 0 })}
                min={-180} max={360} step={5} suffix="°"
              />
            </Field>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="field-label">Glazing</span>
              <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
                {BREAKDOWNS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setGlazingBy(entry.id)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                      glazingBy === entry.id
                        ? 'bg-card font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            {glazingBy === 'building' ? (
              <GlazingRow group={spec.glazing.building} onCommit={setGlazing} />
            ) : breakdown.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No outward-facing walls to break down.
              </p>
            ) : (
              <GlazingList
                groups={breakdown}
                expanded={expanded}
                onToggle={toggleRow}
                onCommit={setGlazing}
              />
            )}

            <p className="text-[11px] text-muted-foreground">
              {glazingBy === 'building'
                ? 'Resizes every window about its own centre.'
                : `Whole building ${percent(spec.glazing.building.windowToWallRatio)}%.`}
            </p>
          </div>

          {notes.length > 0 && (
            <div className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
              <Icons.AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <div className="space-y-1">
                {notes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {formatArea(spec.floorArea)} floor area
            {' · '}{formatNumber(spec.volume, 0)} m³
            {' · '}{spec.zoneCount} zone{spec.zoneCount === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </div>
  );
}
