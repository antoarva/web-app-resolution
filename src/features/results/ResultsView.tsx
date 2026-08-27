import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSimulationStore, annualTotals } from '@/store/simulation-store';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { Button, EmptyState, StatTile, Badge, Select } from '@/components/ui/primitives';
import {
  formatNumber, monthNames, monthlyTotals, chartColor, hourLabel, downloadTextFile, cn,
} from '@/lib/utils';

type Tab = 'summary' | 'monthly' | 'timeseries' | 'zones';

const TABS: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
  { id: 'summary', label: 'Summary', icon: 'PieChart' },
  { id: 'monthly', label: 'Monthly', icon: 'BarChart3' },
  { id: 'timeseries', label: 'Time series', icon: 'Activity' },
  { id: 'zones', label: 'By zone', icon: 'Table2' },
];

export function ResultsView() {
  const result = useSimulationStore((state) => state.result);
  const zoneNames = useSimulationStore((state) => state.zoneNames);
  const location = useSimulationStore((state) => state.location);
  const building = useModelStore((state) => state.building);
  const setView = useUiStore((state) => state.setView);

  const [tab, setTab] = useState<Tab>('summary');

  const totals = useMemo(() => annualTotals(result), [result]);
  const floorArea = building?.totals.floorArea ?? 0;
  const eui = floorArea > 0 ? totals.total / floorArea : 0;

  if (!result) {
    return (
      <EmptyState
        icon={<Icons.BarChart3 className="h-10 w-10" />}
        title="No results yet"
        description="Run the simulation to see loads, temperatures and energy use here."
        action={
          <Button variant="primary" size="sm" onClick={() => setView('simulation')}>
            <Icons.Play className="h-3.5 w-3.5" aria-hidden />
            Go to Run
          </Button>
        }
      />
    );
  }

  const exportCsv = (): void => {
    const rows = ['hour,datetime,outdoor_c,global_solar_wm2,'
      + zoneNames.map((name) => {
        const key = name.replace(/[^\w]+/g, '_');
        return `${key}_temp_c,${key}_heating_w,${key}_cooling_w`;
      }).join(',')];

    for (let hour = 0; hour < result.hours; hour++) {
      const cells = [
        String(hour),
        hourLabel(hour),
        result.outdoorTemp[hour].toFixed(2),
        result.globalSolar[hour].toFixed(1),
      ];
      for (const series of result.zoneSeries) {
        cells.push(
          series.temperature[hour].toFixed(2),
          series.heating[hour].toFixed(1),
          series.cooling[hour].toFixed(1),
        );
      }
      rows.push(cells.join(','));
    }
    downloadTextFile('envelop-results.csv', rows.join('\n'), 'text/csv');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-3">
        {TABS.map((entry) => {
          const Icon = Icons[entry.icon] as Icons.LucideIcon;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                tab === entry.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {entry.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {location && <Badge tone="neutral">{location.city}</Badge>}
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Icons.Download className="h-3.5 w-3.5" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label="Energy use intensity" value={formatNumber(eui, 1)} unit="kWh/m²·yr"
              detail={`${formatNumber(floorArea, 0)} m² floor area`}
              tone={eui < 80 ? 'success' : eui > 200 ? 'warning' : 'primary'}
            />
            <StatTile label="Heating" value={formatNumber(totals.heating, 0)} unit="kWh" tone="danger" />
            <StatTile label="Cooling" value={formatNumber(totals.cooling, 0)} unit="kWh" tone="info" />
            <StatTile label="Lighting" value={formatNumber(totals.lighting, 0)} unit="kWh" tone="warning" />
            <StatTile label="Equipment" value={formatNumber(totals.equipment, 0)} unit="kWh" />
          </div>

          {tab === 'summary' && <SummaryTab result={result} totals={totals} />}
          {tab === 'monthly' && <MonthlyTab result={result} zoneNames={zoneNames} />}
          {tab === 'timeseries' && <TimeSeriesTab result={result} zoneNames={zoneNames} />}
          {tab === 'zones' && <ZonesTab result={result} zoneNames={zoneNames} building={building} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Recharts mount animations are disabled throughout this app.
 *
 * React 18's StrictMode double-mounts effects in development, which can strand
 * a Recharts animation partway through — a pie ends up with sectors of ~0
 * sweep angle and renders blank. These are data displays, so the animation
 * adds nothing worth that risk.
 */

type Result = NonNullable<ReturnType<typeof useSimulationStore.getState>['result']>;

function SummaryTab({ result, totals }: {
  result: Result;
  totals: ReturnType<typeof annualTotals>;
}) {
  const breakdown = [
    { name: 'Heating', value: totals.heating, color: 'hsl(var(--chart-2))' },
    { name: 'Cooling', value: totals.cooling, color: 'hsl(var(--chart-1))' },
    { name: 'Lighting', value: totals.lighting, color: 'hsl(var(--chart-5))' },
    { name: 'Equipment', value: totals.equipment, color: 'hsl(var(--chart-4))' },
  ].filter((entry) => entry.value > 0.01);

  // Gains and losses summed across zones, to show where the energy goes.
  const flows = useMemo(() => {
    let solar = 0;
    let envelope = 0;
    let infiltration = 0;
    for (const summary of result.zoneSummaries) {
      solar += summary.solarKWh;
      envelope += summary.envelopeKWh;
      infiltration += summary.infiltrationKWh;
    }
    return [
      { name: 'Solar gain', value: solar },
      { name: 'Envelope', value: envelope },
      { name: 'Infiltration', value: infiltration },
    ];
  }, [result]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">End-use breakdown</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie isAnimationActive={false}
                data={breakdown} dataKey="value" nameKey="name"
                innerRadius="52%" outerRadius="80%" paddingAngle={2}
              >
                {breakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(value, 0)} kWh`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">Net heat flows (positive is gain to the zone)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flows} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} />
              <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11, fill: 'hsl(var(--chart-text))' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(value, 0)} kWh`}
              />
              <Bar isAnimationActive={false} dataKey="value" radius={[0, 4, 4, 0]}>
                {flows.map((entry, index) => (
                  <Cell key={entry.name} fill={entry.value >= 0 ? chartColor(index) : 'hsl(var(--chart-2))'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Envelope and infiltration are usually net losses over a year in a heating climate,
          which is why they show as negative.
        </p>
      </div>
    </div>
  );
}

function MonthlyTab({ result, zoneNames }: { result: Result; zoneNames: string[] }) {
  const data = useMemo(() => {
    // Sum every zone's hourly power into monthly energy.
    const heating = new Float64Array(result.hours);
    const cooling = new Float64Array(result.hours);
    for (const series of result.zoneSeries) {
      for (let hour = 0; hour < result.hours; hour++) {
        heating[hour] += series.heating[hour];
        cooling[hour] += series.cooling[hour];
      }
    }
    const heatingMonthly = monthlyTotals(heating).map((watts) => watts / 1000);
    const coolingMonthly = monthlyTotals(cooling).map((watts) => watts / 1000);

    return monthNames().map((month, index) => ({
      month,
      Heating: heatingMonthly[index],
      Cooling: coolingMonthly[index],
    }));
  }, [result]);

  const temperatureData = useMemo(() => {
    const starts = monthNames().map((_, index) => index);
    const daysIn = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let cursor = 0;
    return starts.map((index) => {
      const hours = daysIn[index] * 24;
      let outdoorSum = 0;
      const zoneSums = new Array(result.zoneCount).fill(0);
      let counted = 0;

      for (let hour = cursor; hour < cursor + hours && hour < result.hours; hour++) {
        outdoorSum += result.outdoorTemp[hour];
        result.zoneSeries.forEach((series, zone) => { zoneSums[zone] += series.temperature[hour]; });
        counted++;
      }
      cursor += hours;

      const row: Record<string, number | string> = {
        month: monthNames()[index],
        Outdoor: counted > 0 ? outdoorSum / counted : 0,
      };
      zoneSums.forEach((sum, zone) => {
        row[zoneNames[zone] ?? `Zone ${zone + 1}`] = counted > 0 ? sum / counted : 0;
      });
      return row;
    });
  }, [result, zoneNames]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">Monthly heating and cooling energy</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--chart-text))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} unit=" kWh" width={70} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(value, 0)} kWh`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar isAnimationActive={false} dataKey="Heating" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="Cooling" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">Mean monthly temperatures</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={temperatureData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--chart-text))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} unit="°" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(value, 1)} °C`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line isAnimationActive={false}
                type="monotone" dataKey="Outdoor" stroke="hsl(var(--chart-3))"
                strokeWidth={2.5} strokeDasharray="4 3" dot={false}
              />
              {zoneNames.map((name, index) => (
                <Line isAnimationActive={false} key={name} type="monotone" dataKey={name} stroke={chartColor(index)} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function TimeSeriesTab({ result, zoneNames }: { result: Result; zoneNames: string[] }) {
  const [zoneIndex, setZoneIndex] = useState(0);
  const [window, setWindow] = useState<'week-jan' | 'week-jul' | 'year'>('week-jan');

  const { data, step } = useMemo(() => {
    const ranges = {
      'week-jan': { start: 0, length: 168 },
      'week-jul': { start: 4344, length: 168 },
      year: { start: 0, length: result.hours },
    };
    const range = ranges[window];
    // Downsample the annual view so the chart stays responsive.
    const stride = window === 'year' ? Math.max(1, Math.floor(range.length / 730)) : 1;
    const series = result.zoneSeries[zoneIndex];
    if (!series) return { data: [], step: stride };

    const rows: Record<string, number | string>[] = [];
    for (let offset = 0; offset < range.length; offset += stride) {
      const hour = range.start + offset;
      if (hour >= result.hours) break;
      rows.push({
        label: hourLabel(hour),
        Outdoor: result.outdoorTemp[hour],
        Zone: series.temperature[hour],
        Heating: series.heating[hour] / 1000,
        Cooling: -series.cooling[hour] / 1000,
      });
    }
    return { data: rows, step: stride };
  }, [result, zoneIndex, window]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(zoneIndex)}
          onChange={(event) => setZoneIndex(Number(event.target.value))}
          className="h-8 w-48 text-xs"
        >
          {zoneNames.map((name, index) => (
            <option key={name} value={index}>{name}</option>
          ))}
        </Select>
        <div className="flex gap-1">
          {([
            ['week-jan', 'Winter week'],
            ['week-jul', 'Summer week'],
            ['year', 'Full year'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWindow(id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs transition-colors',
                window === id
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'bg-secondary text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {step > 1 && (
          <span className="text-[11px] text-muted-foreground">
            showing every {step}th hour
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">Zone and outdoor temperature</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--chart-text))' }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} unit="°" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(value, 1)} °C`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="Zone" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="Outdoor" stroke="hsl(var(--chart-3))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="field-label mb-3">Heating and cooling power</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--chart-text))' }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-text))' }} unit=" kW" width={60} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 12,
                }}
                formatter={(value: number) => `${formatNumber(Math.abs(value), 2)} kW`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="Heating" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="Cooling" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cooling is drawn negative so the two never overlap visually.
        </p>
      </div>
    </div>
  );
}

function ZonesTab({ result, zoneNames, building }: {
  result: Result;
  zoneNames: string[];
  building: ReturnType<typeof useModelStore.getState>['building'];
}) {
  const rows = result.zoneSummaries.map((summary, index) => {
    const name = zoneNames[index] ?? `Zone ${index + 1}`;
    const zone = building?.zones.find((entry) => entry.name === name);
    const area = zone?.floorArea ?? 0;
    const total = summary.heatingKWh + summary.coolingKWh + summary.lightingKWh + summary.equipmentKWh;
    return { name, summary, area, eui: area > 0 ? total / area : 0, total };
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Zone</th>
              <th className="px-3 py-2 text-right font-medium">Area</th>
              <th className="px-3 py-2 text-right font-medium">EUI</th>
              <th className="px-3 py-2 text-right font-medium">Heating</th>
              <th className="px-3 py-2 text-right font-medium">Cooling</th>
              <th className="px-3 py-2 text-right font-medium">Peak heat</th>
              <th className="px-3 py-2 text-right font-medium">Peak cool</th>
              <th className="px-3 py-2 text-right font-medium">Min T</th>
              <th className="px-3 py-2 text-right font-medium">Max T</th>
              <th className="px-3 py-2 text-right font-medium">Unmet h</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.name} className="hover:bg-accent/30">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.area, 0)} m²</td>
                <td className="px-3 py-2 text-right tabular font-medium">{formatNumber(row.eui, 1)}</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.heatingKWh, 0)}</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.coolingKWh, 0)}</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.peakHeatingW / 1000, 1)} kW</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.peakCoolingW / 1000, 1)} kW</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.minTemp, 1)}</td>
                <td className="px-3 py-2 text-right tabular">{formatNumber(row.summary.maxTemp, 1)}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular',
                  row.summary.unmetHeatingHours + row.summary.unmetCoolingHours > 10 && 'text-warning font-medium',
                )}>
                  {formatNumber(row.summary.unmetHeatingHours + row.summary.unmetCoolingHours, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        EUI is annual energy per unit floor area, in kWh/m²·yr. Unmet hours count timesteps where a
        capacity limit stopped the system reaching setpoint.
      </div>
    </div>
  );
}
