/**
 * The stack of floors, highest at the top, matching how the building is built.
 *
 * Each thumbnail is the level's own drawing, so switching floors is a visual
 * act rather than a menu choice, and the elevation shown beside each one makes
 * the stacking legible before anything is generated.
 *
 * Between every card is an insert point. A stack is rarely complete on the
 * first import — a basement turns up, a mezzanine was missed — so adding a
 * floor is a click on the gap where it belongs, or a drop of its image onto
 * that gap, rather than an append-and-reorder.
 */

import { useState } from 'react';
import * as Icons from 'lucide-react';
import { usePlanStore } from '@/store/plan-store';
import { levelBaseZ, levelHeight } from '@/core/plan/types';
import { cn, formatNumber } from '@/lib/utils';

export function LevelRail({ onAddAt }: { onAddAt: (at: number) => void }) {
  const spec = usePlanStore((state) => state.spec);
  const activeLevelId = usePlanStore((state) => state.activeLevelId);
  const setActiveLevel = usePlanStore((state) => state.setActiveLevel);
  const reorderLevel = usePlanStore((state) => state.reorderLevel);
  const addLevelsFromFiles = usePlanStore((state) => state.addLevelsFromFiles);

  // Highest floor first: the rail reads like a section through the building.
  const ordered = spec.levels.map((level, index) => ({ level, index })).reverse();

  const insertAt = (at: number, files: FileList | null): void => {
    if (files && files.length > 0) void addLevelsFromFiles(files, { at });
    else onAddAt(at);
  };

  return (
    <div className="flex w-28 shrink-0 flex-col border-r border-border bg-card">
      <div className="panel-header justify-center">Floors</div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {/* Above the highest floor. */}
        <InsertPoint label="Add on top" onInsert={(files) => insertAt(spec.levels.length, files)} />

        <ul>
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
                      <span
                        title="No zones traced on this floor yet"
                        className="absolute left-1 top-1 rounded bg-warning px-1 text-[10px] font-medium text-warning-foreground"
                      >
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

                {/* Inserting at this index slides the new floor in underneath. */}
                <InsertPoint
                  label={index === 0 ? 'Add below' : 'Add here'}
                  onInsert={(files) => insertAt(index, files)}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onAddAt(spec.levels.length)}
        className="flex shrink-0 items-center justify-center gap-1 border-t border-border p-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Icons.ImagePlus className="h-3.5 w-3.5" aria-hidden />
        Add floors
      </button>
    </div>
  );
}

/**
 * A gap between two floors that becomes a target on hover or when images are
 * dragged over it. Collapsed it is a hairline, so a tall stack still reads as a
 * stack rather than a list of buttons.
 */
function InsertPoint({ label, onInsert }: {
  label: string;
  onInsert: (files: FileList | null) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        // Only image drags should open a gap here.
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        onInsert(event.dataTransfer.files);
      }}
      className="group/insert relative flex items-center justify-center"
    >
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => onInsert(null)}
        className={cn(
          'my-0.5 flex w-full items-center justify-center gap-1 rounded border border-dashed',
          'text-[10px] transition-all',
          over
            ? 'h-9 border-primary bg-primary/10 text-primary'
            : 'h-1.5 border-transparent text-transparent group-hover/insert:h-7'
            + ' group-hover/insert:border-primary/60 group-hover/insert:bg-accent/40'
            + ' group-hover/insert:text-primary',
        )}
      >
        <Icons.Plus className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{over ? 'Drop here' : label}</span>
      </button>
    </div>
  );
}
