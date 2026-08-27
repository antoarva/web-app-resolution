/**
 * Small styled primitives shared across the app.
 *
 * Deliberately unabstracted: each is a thin wrapper over a native element with
 * token-driven classes, so feature code composes them without a component API
 * to learn.
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type SelectHTMLAttributes, type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
  icon: 'h-8 w-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-md font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

// -------------------------------------------------------------------- Input

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm',
        'placeholder:text-muted-foreground disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

// -------------------------------------------------------------------- Badge

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning-foreground dark:text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export function Badge({ tone = 'neutral', className, children }: {
  tone?: BadgeTone; className?: string; children: ReactNode;
}) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
      BADGE_TONES[tone], className,
    )}>
      {children}
    </span>
  );
}

// -------------------------------------------------------------------- Panel

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, actions, icon }: {
  title: string; actions?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="panel-header">
      {icon}
      <span className="truncate">{title}</span>
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------- Layout

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4 shadow-sm', className)}>
      {children}
    </div>
  );
}

/** Headline figure with a label and optional trailing detail. */
export function StatTile({ label, value, unit, detail, tone = 'neutral' }: {
  label: string; value: string; unit?: string; detail?: string; tone?: BadgeTone;
}) {
  const accent: Record<BadgeTone, string> = {
    neutral: 'text-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
    info: 'text-info',
  };
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="field-label">{label}</div>
      <div className={cn('mt-1 flex items-baseline gap-1', accent[tone])}>
        <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {detail ? <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? <div className="text-muted-foreground/50">{icon}</div> : null}
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />;
}

/** Labelled row for the inspector forms. */
export function Field({ label, hint, children }: {
  label: string; hint?: string; children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (next: boolean) => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-sm"
    >
      <span>{label}</span>
      <span className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}>
        <span className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )} />
      </span>
    </button>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}
