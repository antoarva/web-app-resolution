/** Small shared helpers used across the UI. */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Scales to k/M with a unit suffix, for headline figures. */
export function formatCompact(value: number, unit = ''): string {
  if (!Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const suffix = unit ? ` ${unit}` : '';
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(1)}M${suffix}`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}k${suffix}`;
  if (absolute >= 100) return `${value.toFixed(0)}${suffix}`;
  if (absolute >= 10) return `${value.toFixed(1)}${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
}

export function formatArea(squareMetres: number): string {
  return `${formatNumber(squareMetres, squareMetres >= 100 ? 0 : 1)} m²`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)} s`;
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.round((milliseconds % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function monthNames(): string[] {
  return MONTH_NAMES;
}

/** Hour-of-year (0-based) to a readable date-time label. */
export function hourLabel(hourOfYear: number): string {
  const dayOfYear = Math.floor(hourOfYear / 24);
  const hour = hourOfYear % 24;
  let remaining = dayOfYear;
  let month = 0;
  while (month < 12 && remaining >= DAYS_IN_MONTH[month]) {
    remaining -= DAYS_IN_MONTH[month];
    month++;
  }
  return `${MONTH_NAMES[Math.min(month, 11)]} ${remaining + 1}, ${String(hour).padStart(2, '0')}:00`;
}

/** First hour-of-year of each month, for slicing annual series. */
export function monthStartHours(): number[] {
  const starts: number[] = [];
  let cumulative = 0;
  for (const days of DAYS_IN_MONTH) {
    starts.push(cumulative * 24);
    cumulative += days;
  }
  return starts;
}

export function daysInMonth(monthIndex: number): number {
  return DAYS_IN_MONTH[monthIndex] ?? 30;
}

/** Sums a series into 12 monthly totals. */
export function monthlyTotals(series: ArrayLike<number>): number[] {
  const starts = monthStartHours();
  const totals: number[] = [];
  for (let month = 0; month < 12; month++) {
    const start = starts[month];
    const end = start + daysInMonth(month) * 24;
    let sum = 0;
    for (let hour = start; hour < end && hour < series.length; hour++) sum += series[hour];
    totals.push(sum);
  }
  return totals;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Trailing-edge debounce, used for editor-to-model syncing. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Args): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
  };
  return debounced;
}

export function downloadTextFile(filename: string, contents: string, mimeType = 'text/plain'): void {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Stable colour for a series index, drawn from the chart tokens. */
export function chartColor(index: number): string {
  return `hsl(var(--chart-${(index % 6) + 1}))`;
}
