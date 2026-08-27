import { useMemo } from 'react';
import * as Icons from 'lucide-react';
import type { IdfObject } from '@/core/idf/types';
import { getClassSchema, fieldAt, type IddField } from '@/core/idd/schema';
import { useModelStore } from '@/store/model-store';
import { Input, Select, Button, Badge } from '@/components/ui/primitives';
import { objectsOfClasses, objectName } from '@/core/idf/types';
import { cn } from '@/lib/utils';

/**
 * Schema-driven form for one IDF object.
 *
 * The control shown per field follows its IDD type: a choice becomes a select,
 * an object-list resolves the names of referenced objects, and a numeric field
 * gets range validation. Unknown fields fall back to a plain text input, so a
 * class the schema does not cover is still editable.
 */
export function FieldEditor({ object }: { object: IdfObject }) {
  const model = useModelStore((state) => state.model);
  const updateField = useModelStore((state) => state.updateObjectField);
  const schema = getClassSchema(object.className);

  // Show every declared field plus whatever the object actually carries, so
  // extensible tails (surface vertices) stay editable.
  const fieldCount = Math.max(
    object.fields.length,
    schema?.fields.length ?? 0,
  );

  const rows = useMemo(() => {
    const entries: { index: number; field: IddField | undefined; value: string }[] = [];
    for (let index = 0; index < fieldCount; index++) {
      entries.push({
        index,
        field: schema ? fieldAt(schema, index) : undefined,
        value: object.fields[index] ?? '',
      });
    }
    return entries;
  }, [fieldCount, schema, object.fields]);

  const addField = (): void => {
    void updateField(object.id, object.fields.length, '');
  };

  return (
    <div className="space-y-3">
      {schema && (
        <div className="rounded-md bg-muted/50 p-2.5">
          <div className="flex items-center gap-2">
            <Badge tone="primary">{schema.group}</Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{schema.memo}</p>
        </div>
      )}
      {!schema && (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-xs">
          <Icons.HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium">{object.className}</span> is not in the bundled schema,
            so fields are shown untyped. Edits are still written through to the file.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {rows.map(({ index, field, value }) => (
          <FieldRow
            key={index}
            index={index}
            field={field}
            value={value}
            model={model}
            onChange={(next) => void updateField(object.id, index, next)}
          />
        ))}
      </div>

      {schema?.extensible && (
        <Button variant="outline" size="sm" onClick={addField} className="w-full">
          <Icons.Plus className="h-3.5 w-3.5" aria-hidden />
          Add field
        </Button>
      )}
    </div>
  );
}

function FieldRow({ index, field, value, model, onChange }: {
  index: number;
  field: IddField | undefined;
  value: string;
  model: ReturnType<typeof useModelStore.getState>['model'];
  onChange: (next: string) => void;
}) {
  const label = field?.name ?? `Field ${index + 1}`;
  const isBlank = value.trim() === '';
  const missing = field?.required && isBlank;

  // Numeric range check: only flags values that are actually out of bounds.
  let rangeError: string | null = null;
  if (field?.type === 'numeric' || field?.type === 'integer') {
    const numeric = Number(value);
    const isKeyword = ['autosize', 'autocalculate'].includes(value.trim().toLowerCase());
    if (!isBlank && !isKeyword && Number.isFinite(numeric)) {
      if (field.minimum !== undefined && numeric < field.minimum) {
        rangeError = `Below minimum (${field.minimum})`;
      } else if (field.maximum !== undefined && numeric > field.maximum) {
        rangeError = `Above maximum (${field.maximum})`;
      }
    } else if (!isBlank && !isKeyword && !Number.isFinite(numeric)) {
      rangeError = 'Not a number';
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2">
      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          <span className={cn('truncate text-[11px]', missing ? 'text-destructive' : 'text-muted-foreground')}>
            {label}
          </span>
          {field?.required && <span className="text-destructive">*</span>}
        </div>
        {field?.units && <div className="text-[10px] text-muted-foreground/70">{field.units}</div>}
      </div>

      <div className="min-w-0">
        <FieldControl field={field} value={value} model={model} onChange={onChange} />
        {rangeError && <div className="mt-0.5 text-[10px] text-destructive">{rangeError}</div>}
        {!rangeError && field?.note && (
          <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/70">{field.note}</div>
        )}
      </div>
    </div>
  );
}

function FieldControl({ field, value, model, onChange }: {
  field: IddField | undefined;
  value: string;
  model: ReturnType<typeof useModelStore.getState>['model'];
  onChange: (next: string) => void;
}) {
  // Choice: a fixed keyword list, plus whatever the file already holds.
  if (field?.type === 'choice' && field.choices) {
    const options = field.choices.includes(value) || value === '' ? field.choices : [...field.choices, value];
    return (
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 text-xs">
        {!options.includes('') && <option value="">—</option>}
        {options.map((choice) => (
          <option key={choice || 'blank'} value={choice}>{choice || '—'}</option>
        ))}
      </Select>
    );
  }

  // Object list: names of objects in the referenced classes.
  if (field?.type === 'object-list' && field.references) {
    const names = objectsOfClasses(model, field.references)
      .map(objectName)
      .filter((name) => name.trim() !== '');
    const options = value && !names.includes(value) ? [value, ...names] : names;
    return (
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 text-xs">
        <option value="">—</option>
        {options.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select>
    );
  }

  const autosized = ['autosize', 'autocalculate'].includes(value.trim().toLowerCase());
  return (
    <div className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field?.default ?? ''}
        inputMode={field?.type === 'numeric' || field?.type === 'integer' ? 'decimal' : undefined}
        className={cn('h-7 text-xs', autosized && 'italic text-muted-foreground')}
      />
      {field?.autosizable && !autosized && (
        <button
          type="button"
          onClick={() => onChange('autosize')}
          title="Let EnergyPlus size this field"
          className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          auto
        </button>
      )}
    </div>
  );
}
