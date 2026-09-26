/**
 * A numeric input that only reports a value once the edit is finished.
 *
 * Dimension fields drive a rescale of the whole plan, so committing on every
 * keystroke would make typing "12" briefly build a one-metre building. The
 * field holds its own text until blur or Enter, and re-syncs whenever the value
 * changes from elsewhere.
 */

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function NumberField({
  value, onCommit, step = 0.1, min, max, suffix, disabled, className, placeholder,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const format = (input: number | null): string =>
    input === null || !Number.isFinite(input) ? '' : String(Math.round(input * 1000) / 1000);

  const [text, setText] = useState(() => format(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(format(value));
  }, [value, editing]);

  const commit = (): void => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setText(format(value));
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setText(format(next));
    onCommit(next);
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setEditing(true);
          setText(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            (event.target as HTMLInputElement).blur();
          } else if (event.key === 'Escape') {
            setEditing(false);
            setText(format(value));
          }
        }}
        className={cn('tabular', suffix && 'pr-8')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}
