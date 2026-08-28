/**
 * The stack of floors, highest at the top, matching how the building is built.
 *
 * Each thumbnail is the level's own drawing, so switching floors is a visual
 * act rather than a menu choice, and the elevation shown beside each one makes
 * the stacking legible before anything is generated.
 */

import * as Icons from 'lucide-react';
import { usePlanStore } from '@/store/plan-store';
import { levelBaseZ, levelHeight } from '@/core/plan/types';
import { cn, formatNumber } from '@/lib/utils';

export function LevelRail({ onAdd }: { onAdd: () => void }) {
  const spec = usePlanStore((state) => state.spec);
  const activeLevelId = usePlanStore((state) => state.activeLevelId);
  const setActiveLevel = usePlanStore((state) => state.setActiveLevel);
  const reorderLevel = usePlanStore((state) => state.reorderLevel);

  // Highest floor first: the rail reads like a section through the building.
  const ordered = spec.levels.map((level, index) => ({ level, index })).reverse();

  return (
    <div className="flex w-24 shrink-0 flex-col border-r border-border bg-card">
      <div className="panel-header justify-center">Floors</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <ul className="space-y-1.5">
          {ordered.map(({ level, index }) => {
            const active = level.id === activeLevelId;
            const base = levelBaseZ(spec, index);
            return (
              <li key={level.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setActiveLevel(level.id)}
                  className={cn(
                    'w-full overflow-hidden rounded-md border text-left transition-colors',
                    active
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:border-primary/60',
                  )}
                >
                  <div className="relative flex h-14 items-center justify-center bg-muted/60">
                    {level.image ? (
                      <img
                        src={level.image.src}
                        alt=""
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <Icons.SquareDashed className="h-5 w-5 text-muted-foreground" aria-hidden />
                    )}
                    {level.repeat > 1 && (
                      <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                        ×{level.repeat}
                      </span>
                    )}
                    {level.zones.length === 0 && (
                      <span className="absolute left-1 top-1 rounded bg-warning/90 px-1 text-[10px] font-medium text-white">
                        !
                      </span>
                    )}
                  </div>
                  <div className={cn(
                    'px-1.5 py-1',
                    active ? 'bg-primary text-primary-foreground' : 'bg-card',
                  )}>
                    <div className="truncate text-[11px] font-medium">{level.name}</div>
                    <div className={cn(
                      'text-[10px] tabular',
                      active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}>
                      +{formatNumber(base, 1)} m
                      {level.repeat > 1 && ` · ${formatNumber(levelHeight(spec, level), 1)} m`}
                    </div>
                  </div>
                </button>

                {/* Reordering lives on hover so the rail stays a picture. */}
                <div className="pointer-events-none absolute inset-y-0 -right-0.5 flex flex-col justify-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <button
                    type="button"
                    title="Move up"
                    disabled={index === spec.levels.length - 1}
                    onClick={() => reorderLevel(level.id, 1)}
                    className="flex h-4 w-4 items-center justify-center rounded border border-border bg-card shadow-sm disabled:opacity-30"
                  >
                    <Icons.ChevronUp className="h-3 w-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={index === 0}
                    onClick={() => reorderLevel(level.id, -1)}
                    className="flex h-4 w-4 items-center justify-center rounded border border-border bg-card shadow-sm disabled:opacity-30"
                  >
                    <Icons.ChevronDown className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="flex shrink-0 items-center justify-center gap-1 border-t border-border p-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Icons.Plus className="h-3.5 w-3.5" aria-hidden />
        Floors
      </button>
    </div>
  );
}
