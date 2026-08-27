import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore, selectedObject } from '@/store/model-store';
import { objectName, countByClass } from '@/core/idf/types';
import { classesByGroup, getClassSchema } from '@/core/idd/schema';
import { FieldEditor } from './FieldEditor';
import { Button, Input, EmptyState, Badge, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Browse every object in the file, grouped by class, with an editor alongside. */
export function ExplorerView() {
  const model = useModelStore((state) => state.model);
  const selection = useModelStore((state) => state.selection);
  const select = useModelStore((state) => state.select);
  const deleteObject = useModelStore((state) => state.deleteObject);
  const duplicateObject = useModelStore((state) => state.duplicateObject);
  const addObject = useModelStore((state) => state.addObject);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Zone', 'BuildingSurface:Detailed']));
  const [addingClass, setAddingClass] = useState('');

  const active = useModelStore(selectedObject);
  const counts = useMemo(() => countByClass(model), [model]);

  // Group objects by class, filtered by the search box.
  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    const groups = new Map<string, typeof model.objects>();

    for (const object of model.objects) {
      if (term) {
        const haystack = `${object.className} ${object.fields.join(' ')}`.toLowerCase();
        if (!haystack.includes(term)) continue;
      }
      const list = groups.get(object.className);
      if (list) list.push(object);
      else groups.set(object.className, [object]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [model, query]);

  const toggle = (className: string): void => {
    const next = new Set(expanded);
    if (next.has(className)) next.delete(className);
    else next.add(className);
    setExpanded(next);
  };

  // Searching should reveal matches without the user expanding each class.
  const isExpanded = (className: string): boolean =>
    query.trim() !== '' || expanded.has(className);

  const handleAdd = async (): Promise<void> => {
    if (!addingClass) return;
    const schema = getClassSchema(addingClass);
    const fields = schema
      ? schema.fields.map((field, index) => (index === 0 ? `New ${addingClass}` : field.default ?? ''))
      : [`New ${addingClass}`];
    await addObject(addingClass, fields);
    setAddingClass('');
    setExpanded(new Set([...expanded, addingClass]));
  };

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 space-y-2 border-b border-border p-2.5">
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search objects and values…"
              className="h-8 pl-7 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <Icons.X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>

          <div className="flex gap-1.5">
            <Select
              value={addingClass}
              onChange={(event) => setAddingClass(event.target.value)}
              className="h-7 flex-1 text-xs"
            >
              <option value="">Add object…</option>
              {[...classesByGroup().entries()].map(([group, entries]) => (
                <optgroup key={group} label={group}>
                  {entries.map((entry) => (
                    <option key={entry.name} value={entry.name}>{entry.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Button
              variant="primary" size="sm"
              disabled={!addingClass}
              onClick={() => void handleAdd()}
            >
              <Icons.Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {grouped.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No objects match “{query}”.
            </div>
          )}

          {grouped.map(([className, objects]) => {
            const open = isExpanded(className);
            const total = counts.get(className) ?? objects.length;
            return (
              <div key={className}>
                <button
                  type="button"
                  onClick={() => toggle(className)}
                  className="flex w-full items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5 text-left hover:bg-accent/40"
                >
                  <Icons.ChevronRight
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-90')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{className}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground tabular">
                    {objects.length === total ? total : `${objects.length}/${total}`}
                  </span>
                </button>

                {open && objects.map((object) => {
                  const name = objectName(object);
                  const isActive = selection.objectId === object.id;
                  return (
                    <div
                      key={object.id}
                      className={cn(
                        'group flex items-center gap-1 border-b border-border/40 pl-7 pr-1.5',
                        isActive ? 'bg-accent' : 'hover:bg-accent/40',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => select({ objectId: object.id, surfaceId: object.id })}
                        className="min-w-0 flex-1 truncate py-1.5 text-left text-xs"
                        title={name || '(unnamed)'}
                      >
                        {name || <span className="italic text-muted-foreground">(unnamed)</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => void duplicateObject(object.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
                        title="Duplicate"
                      >
                        <Icons.Copy className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteObject(object.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                        title="Delete"
                      >
                        <Icons.Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {active ? (
          <div className="mx-auto max-w-3xl p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">
                  {objectName(active) || <span className="italic text-muted-foreground">(unnamed)</span>}
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone="primary">{active.className}</Badge>
                  <span className="text-xs text-muted-foreground tabular">
                    {active.fields.length} fields
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button variant="outline" size="sm" onClick={() => void duplicateObject(active.id)}>
                  <Icons.Copy className="h-3.5 w-3.5" aria-hidden />
                  Duplicate
                </Button>
                <Button variant="outline" size="sm" onClick={() => void deleteObject(active.id)}>
                  <Icons.Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete
                </Button>
              </div>
            </div>
            <FieldEditor object={active} />
          </div>
        ) : (
          <EmptyState
            icon={<Icons.ListTree className="h-10 w-10" />}
            title="Select an object"
            description="Pick an object on the left to edit its fields. Every change is written straight back to the IDF text."
          />
        )}
      </div>
    </div>
  );
}
