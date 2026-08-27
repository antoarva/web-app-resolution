import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useModelStore } from '@/store/model-store';
import { objectsOfClasses, objectName, numericField } from '@/core/idf/types';
import { parseCompactSchedule, representativeDays, type ParsedSchedule } from './parse-schedule';
import { Badge, EmptyState, Input, StatTile } from '@/components/ui/primitives';
import { formatNumber, chartColor, monthNames, cn } from '@/lib/utils';

/** Operating profiles: what runs when, through the day and through the year. */
export function SchedulesView() {
  const model = useModelStore((state) => state.model);
  const [query, setQuery] = useState('');
  const [activeName, setActiveName] = useState<string | null>(null);

  const schedules = useMemo<ParsedSchedule[]>(() => {
    const compact = objectsOfClasses(model, ['Schedule:Compact']).map(parseCompactSchedule);
    // Constant schedules have no rules; synthesise a flat profile so they chart.
    const constant = objectsOfClasses(model, ['Schedule:Constant']).map((object) => {
      const value = numericField(object, 2, 0);
      const annual = new Float64Array(8760).fill(value);
      return {
        name: objectName(object),
        typeLimits: object.fields[1] ?? '',
        periods: [{
          through: '12/31', throughDay: 365,
          days: [{ dayTypes: ['AllDays' as const], hourly: new Array<number>(24).fill(value) }],
        }],
        annual, min: value, max: value, mean: value, issues: [],
      } satisfies ParsedSchedule;
    });
    return [...compact, ...constant].sort((a, b) => a.name.localeCompare(b.name));
  }, [model]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return schedules;
    return schedules.filter((entry) => entry.name.toLowerCase().includes(term));
  }, [schedules, query]);

  const active = useMemo(
    () => filtered.find((entry) => entry.name === activeName) ?? filtered[0] ?? null,
    [filtered, activeName],
  );

  if (schedules.length === 0) {
    return (
      <EmptyState
        icon={<Icons.CalendarClock className="h-10 w-10" />}
        title="No schedules defined"
        description="Schedules drive occupancy, lighting, equipment and setpoints through the year. Load a template to see how they are structured."
      />
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 border-b border-border p-2.5">
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search schedules…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((schedule) => (
            <li key={schedule.name}>
              <button
                type="button"
                onClick={() => setActiveName(schedule.name)}
                className={cn(
                  'w-full border-b border-border/60 px-3 py-2 text-left transition-colors',
                  active?.name === schedule.name ? 'bg-accent' : 'hover:bg-accent/40',
                )}
              >
                <div className="truncate text-xs font-medium">{schedule.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground tabular">
                  <span>{formatNumber(schedule.min, 1)}–{formatNumber(schedule.max, 1)}</span>
                  {schedule.typeLimits && <span className="truncate">· {schedule.typeLimits}</span>}
                  {schedule.issues.length > 0 && (
                    <Icons.AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-hidden />
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {active ? <ScheduleDetail schedule={active} /> : (
          <EmptyState title="No match" description={`Nothing matches “${query}”.`} />
        )}
      </div>
    </div>
  );
}

function ScheduleDetail({ schedule }: { schedule: ParsedSchedule }) {
  const days = useMemo(() => representativeDays(schedule), [schedule]);

  // One row per hour of day, one column per day of year.
  const heatmap = useMemo(() => {
    if (!schedule.annual) return null;
    const range = schedule.max - schedule.min;
    return { annual: schedule.annual, range: range > 1e-9 ? range : 1 };
  }, [schedule]);

  const chartData = useMemo(() => {
    const rows: Record<string, number | string>[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const row: Record<string, number | string> = { hour: `${String(hour).padStart(2, '0')}:00` };
      days.forEach((day) => { row[day.label] = day.hourly[hour]; });
      rows.push(row);
    }
    return rows;
  }, [days]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{schedule.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {schedule.typeLimits && <Badge tone="primary">{schedule.typeLimits}</Badge>}
          <Badge tone="neutral">{schedule.periods.length} period{schedule.periods.length === 1 ? '' : 's'}</Badge>
          <Badge tone="neutral">{days.length} day type{days.length === 1 ? '' : 's'}</Badge>
        </div>
      </div>

      {schedule.issues.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Icons.AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
            Issues in this schedule
          </div>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
            {schedule.issues.map((issue, index) => <li key={index}>{issue}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Minimum" value={formatNumber(schedule.min, 2)} />
        <StatTile label="Maximum" value={formatNumber(schedule.max, 2)} />
        <StatTile label="Annual mean" value={formatNumber(schedule.mean, 3)} />
        <StatTile
          label="Full-load hours"
          value={schedule.max > 0 ? formatNumber((schedule.mean / schedule.max) * 8760, 0) : '0'}
          unit="h"
          detail="equivalent hours at peak"
        />
      </div>

      <div>
        <div className="field-label mb-2">Daily profiles</div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: 8, fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {days.map((day, index) => (
                  <Line isAnimationActive={false}
                    key={day.label}
                    type="stepAfter"
                    dataKey={day.label}
                    stroke={chartColor(index)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {heatmap && (
        <div>
          <div className="field-label mb-2">Annual pattern — hour of day against day of year</div>
          <AnnualHeatmap annual={heatmap.annual} min={schedule.min} range={heatmap.range} />
        </div>
      )}

      <div>
        <div className="field-label mb-2">Rules</div>
        <div className="space-y-2">
          {schedule.periods.map((period, index) => (
            <div key={index} className="overflow-hidden rounded-md border border-border">
              <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium">
                Through {period.through}
              </div>
              <div className="divide-y divide-border/60">
                {period.days.map((profile, dayIndex) => (
                  <div key={dayIndex} className="px-3 py-2">
                    <div className="text-[11px] font-medium">{profile.dayTypes.join(', ')}</div>
                    <div className="mt-1 flex gap-px">
                      {profile.hourly.map((value, hour) => {
                        const span = schedule.max - schedule.min;
                        const intensity = span > 1e-9 ? (value - schedule.min) / span : 0;
                        return (
                          <div
                            key={hour}
                            className="h-5 flex-1 rounded-sm"
                            style={{ backgroundColor: `hsl(var(--chart-1) / ${0.12 + intensity * 0.88})` }}
                            title={`${String(hour).padStart(2, '0')}:00 — ${formatNumber(value, 2)}`}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Canvas-free heatmap: 365 columns of 24 cells. Rendered as CSS gradients per
 * column so the whole year stays in the DOM without 8760 elements.
 */
function AnnualHeatmap({ annual, min, range }: { annual: Float64Array; min: number; range: number }) {
  const columns = useMemo(() => {
    const result: string[] = [];
    for (let day = 0; day < 365; day++) {
      const stops: string[] = [];
      for (let hour = 0; hour < 24; hour++) {
        const value = annual[day * 24 + hour];
        const intensity = (value - min) / range;
        const alpha = (0.08 + intensity * 0.92).toFixed(3);
        const from = ((hour / 24) * 100).toFixed(2);
        const to = (((hour + 1) / 24) * 100).toFixed(2);
        stops.push(`hsl(var(--chart-1) / ${alpha}) ${from}% ${to}%`);
      }
      result.push(`linear-gradient(to bottom, ${stops.join(', ')})`);
    }
    return result;
  }, [annual, min, range]);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex h-40 gap-px overflow-hidden rounded">
        {columns.map((gradient, day) => (
          <div key={day} className="flex-1" style={{ background: gradient }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        {monthNames().map((month) => <span key={month}>{month}</span>)}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{formatNumber(min, 1)}</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: 'linear-gradient(to right, hsl(var(--chart-1) / 0.08), hsl(var(--chart-1)))' }}
        />
        <span>{formatNumber(min + range, 1)}</span>
      </div>
    </div>
  );
}
