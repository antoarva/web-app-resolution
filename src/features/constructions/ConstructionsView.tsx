import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { allConstructions, type ConstructionProperties } from '@/core/model/constructions';
import { objectsOfClasses, objectName, numericField, textField } from '@/core/idf/types';
import { Badge, EmptyState, Input, StatTile } from '@/components/ui/primitives';
import { formatNumber, cn } from '@/lib/utils';

/**
 * Assemblies and their thermal performance.
 *
 * The layer bar is drawn to scale by thickness, so a heavily insulated
 * assembly reads differently from a thin one at a glance.
 */
export function ConstructionsView() {
  const model = useModelStore((state) => state.model);
  const building = useModelStore((state) => state.building);
  const select = useModelStore((state) => state.select);

  const [query, setQuery] = useState('');
  const [activeName, setActiveName] = useState<string | null>(null);

  const constructions = useMemo(() => allConstructions(model), [model]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return constructions;
    return constructions.filter((entry) =>
      entry.name.toLowerCase().includes(term)
      || entry.layers.some((layer) => layer.name.toLowerCase().includes(term)));
  }, [constructions, query]);

  const active = useMemo(
    () => filtered.find((entry) => entry.name === activeName) ?? filtered[0] ?? null,
    [filtered, activeName],
  );

  // Where each assembly is used, so a change can be traced to real surfaces.
  const usage = useMemo(() => {
    const counts = new Map<string, { count: number; area: number }>();
    if (!building) return counts;
    for (const zone of building.zones) {
      for (const surface of zone.surfaces) {
        const key = surface.constructionName.toLowerCase();
        const entry = counts.get(key) ?? { count: 0, area: 0 };
        counts.set(key, { count: entry.count + 1, area: entry.area + surface.area });
        for (const child of surface.children) {
          const childKey = child.constructionName.toLowerCase();
          const childEntry = counts.get(childKey) ?? { count: 0, area: 0 };
          counts.set(childKey, { count: childEntry.count + 1, area: childEntry.area + child.area });
        }
      }
    }
    return counts;
  }, [building]);

  const materials = useMemo(
    () => objectsOfClasses(model, ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas']),
    [model],
  );

  if (constructions.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Layers className="h-10 w-10" />}
        title="No constructions defined"
        description="This model has no Construction objects. Load a template, or add materials and assemblies from the Objects view."
      />
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 border-b border-border p-2.5">
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assemblies…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((entry) => {
            const used = usage.get(entry.name.toLowerCase());
            return (
              <li key={entry.name}>
                <button
                  type="button"
                  onClick={() => setActiveName(entry.name)}
                  className={cn(
                    'w-full border-b border-border/60 px-3 py-2 text-left transition-colors',
                    active?.name === entry.name ? 'bg-accent' : 'hover:bg-accent/40',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {entry.isWindow
                      ? <Icons.Blinds className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                      : <Icons.Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-5 text-[10px] text-muted-foreground tabular">
                    <span>U {formatNumber(entry.uValue, 2)}</span>
                    <span>{entry.layers.length} layers</span>
                    {used && <span>· {used.count} surfaces</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {materials.length} materials · {constructions.length} assemblies
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {active ? (
          <ConstructionDetail
            construction={active}
            usage={usage.get(active.name.toLowerCase())}
            onSelectMaterial={(name) => {
              const match = materials.find((entry) => objectName(entry) === name);
              if (match) select({ objectId: match.id });
            }}
            materialDetail={(name) => {
              const match = materials.find((entry) => objectName(entry) === name);
              if (!match) return null;
              return {
                className: match.className,
                conductivity: numericField(match, 3, 0),
                density: numericField(match, 4, 0),
                roughness: textField(match, 1, ''),
              };
            }}
          />
        ) : (
          <EmptyState title="No match" description={`Nothing matches “${query}”.`} />
        )}
      </div>
    </div>
  );
}

function ConstructionDetail({ construction, usage, onSelectMaterial, materialDetail }: {
  construction: ConstructionProperties;
  usage?: { count: number; area: number };
  onSelectMaterial: (name: string) => void;
  materialDetail: (name: string) => { className: string; conductivity: number; density: number; roughness: string } | null;
}) {
  const totalThickness = construction.thickness;
  // Massless layers have no thickness, so give them a nominal slice of the bar.
  const barWidths = construction.layers.map((layer) =>
    layer.thickness > 0 && totalThickness > 0
      ? (layer.thickness / totalThickness) * 100
      : 6);
  const widthSum = barWidths.reduce((sum, width) => sum + width, 0);
  const normalised = barWidths.map((width) => (width / widthSum) * 100);

  const layerColor = (kind: string, index: number): string => {
    if (kind === 'glazing') return 'hsl(199 89% 70%)';
    if (kind === 'gas') return 'hsl(199 60% 88%)';
    if (kind === 'airgap') return 'hsl(210 20% 88%)';
    if (kind === 'nomass') return 'hsl(142 50% 65%)';
    return `hsl(${25 + index * 18} 40% ${58 + (index % 3) * 8}%)`;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{construction.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={construction.isWindow ? 'info' : 'primary'}>
            {construction.isWindow ? 'Glazing' : 'Opaque'}
          </Badge>
          <Badge tone="neutral">{construction.layers.length} layers</Badge>
          {usage && <Badge tone="neutral">{usage.count} surfaces · {formatNumber(usage.area, 0)} m²</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="U-value" value={formatNumber(construction.uValue, 3)} unit="W/m²K"
          detail="including surface films"
          tone={construction.uValue < 0.3 ? 'success' : construction.uValue > 1.5 ? 'warning' : 'neutral'}
        />
        <StatTile label="R-value" value={formatNumber(construction.resistance, 2)} unit="m²K/W" detail="layers only" />
        <StatTile label="Thickness" value={formatNumber(totalThickness * 1000, 0)} unit="mm" />
        {construction.isWindow
          ? <StatTile label="SHGC" value={formatNumber(construction.shgc, 2)} detail="solar heat gain" tone="info" />
          : <StatTile label="Heat capacity" value={formatNumber(construction.heatCapacity, 0)} unit="kJ/m²K" detail="thermal mass" />}
      </div>

      <div>
        <div className="field-label mb-2">Layer stack (outside to inside, drawn to scale)</div>
        <div className="flex h-16 overflow-hidden rounded-md border border-border">
          {construction.layers.map((layer, index) => (
            <div
              key={`${layer.name}-${index}`}
              className="group relative flex items-center justify-center border-r border-border/50 last:border-r-0"
              style={{ width: `${normalised[index]}%`, backgroundColor: layerColor(layer.kind, index) }}
              title={`${layer.name} — ${layer.thickness > 0 ? `${(layer.thickness * 1000).toFixed(0)} mm` : 'no thickness'}, R ${formatNumber(layer.resistance, 3)}`}
            >
              <span className="rotate-0 truncate px-1 text-[9px] font-medium text-slate-900/70">
                {normalised[index] > 8 ? layer.name.split(' ')[0] : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Exterior</span>
          <span>Interior</span>
        </div>
      </div>

      <div>
        <div className="field-label mb-2">Layers</div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Material</th>
                <th className="px-3 py-1.5 text-right font-medium">Thickness</th>
                <th className="px-3 py-1.5 text-right font-medium">λ</th>
                <th className="px-3 py-1.5 text-right font-medium">ρ</th>
                <th className="px-3 py-1.5 text-right font-medium">R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {construction.layers.map((layer, index) => {
                const detail = materialDetail(layer.name);
                return (
                  <tr key={`${layer.name}-${index}`} className="hover:bg-accent/30">
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectMaterial(layer.name)}
                        className="flex items-center gap-1.5 text-left hover:text-primary hover:underline"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: layerColor(layer.kind, index) }}
                        />
                        <span className="truncate">{layer.name}</span>
                      </button>
                      {detail && (
                        <span className="ml-4 text-[10px] text-muted-foreground">{detail.className}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">
                      {layer.thickness > 0 ? `${(layer.thickness * 1000).toFixed(0)} mm` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">
                      {layer.conductivity > 0 ? formatNumber(layer.conductivity, 3) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">
                      {layer.density > 0 ? formatNumber(layer.density, 0) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatNumber(layer.resistance, 3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          λ is conductivity in W/m·K, ρ is density in kg/m³, R is thermal resistance in m²K/W.
          The U-value above adds inside and outside surface film resistances to the layer total.
        </p>
      </div>
    </div>
  );
}
