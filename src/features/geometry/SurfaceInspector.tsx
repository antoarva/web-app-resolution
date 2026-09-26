import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { allSurfaces, type ModelSurface } from '@/core/model/building';
import { computeConstruction } from '@/core/model/constructions';
import { glazingFor, type GlazingScope } from '@/core/model/transform';
import { formatArea, formatNumber, cn } from '@/lib/utils';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { NumberField } from '@/components/ui/NumberField';
import { orientationName } from '@/core/templates/geometry';

/**
 * Glazing for whatever is selected, edited in place.
 *
 * The figure is measured from the model rather than remembered, so it is an
 * absolute target like every other dimension field: what it shows is what the
 * walls actually carry, and typing the old number back restores them.
 */
function GlazingEditor({ scope, hint, label = 'Glazing' }: {
  scope: GlazingScope;
  hint: string;
  label?: string;
}) {
  const model = useModelStore((state) => state.model);
  const busy = useModelStore((state) => state.busy);
  const editGeometry = useModelStore((state) => state.editGeometry);
  const [notes, setNotes] = useState<string[]>([]);

  // Keyed on the scope's shape rather than its identity: the caller builds a
  // fresh object every render, and re-measuring the model is not free.
  const key = JSON.stringify(scope);
  const group = useMemo(() => glazingFor(model.objects, scope), [model, key]);
  if (!group) return null;

  return (
    <div className={cn('space-y-1.5', busy && 'pointer-events-none opacity-60')}>
      <div className="field-label">{label}</div>
      <NumberField
        value={Math.round(group.windowToWallRatio * 1000) / 10}
        onCommit={(value) => {
          if (value === null) return;
          void editGeometry({ glazing: [{ scope, ratio: value / 100 }] }).then(setNotes);
        }}
        min={0} max={95} step={1} suffix="%"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      {notes.length > 0 && (
        <div className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
          <Icons.AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1">
            {notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only detail for the surface picked in the 3D view. */
export function SurfaceInspector() {
  const building = useModelStore((state) => state.building);
  const model = useModelStore((state) => state.model);
  const surfaceId = useModelStore((state) => state.selection.surfaceId);
  const zoneName = useModelStore((state) => state.selection.zoneName);

  const surface = useMemo<ModelSurface | null>(() => {
    if (!building || !surfaceId) return null;
    return allSurfaces(building).find((entry) => entry.id === surfaceId) ?? null;
  }, [building, surfaceId]);

  const zone = useMemo(() => {
    if (!building) return null;
    const name = surface?.zoneName ?? zoneName;
    if (!name) return null;
    return building.zones.find((entry) => entry.name === name) ?? null;
  }, [building, surface, zoneName]);

  /**
   * A wall edits its own glazing; an opening edits the wall it sits in, which
   * is what someone clicking a window is reaching for.
   */
  const glazing = useMemo<{ scope: GlazingScope; hint: string; label: string } | null>(() => {
    if (!surface) return null;
    if (surface.category === 'wall' && surface.boundary === 'outdoors') {
      return {
        scope: { kind: 'surface', name: surface.name },
        label: `Glazing on ${orientationName(surface.azimuth)} wall`,
        hint: 'This wall only. Resizes its windows, or builds one where there is none.',
      };
    }
    if (surface.category === 'window' || surface.category === 'door') {
      const host = building?.zones
        .flatMap((entry) => entry.surfaces)
        .find((wall) => wall.children.some((child) => child.id === surface.id));
      if (host) {
        return {
          scope: { kind: 'surface', name: host.name },
          label: 'Glazing on host wall',
          hint: `${host.name} only. Resizes every opening on it.`,
        };
      }
    }
    return null;
  }, [surface, building]);

  const construction = useMemo(() => {
    if (!surface?.constructionName) return null;
    const orientation = surface.category === 'roof' || surface.category === 'ceiling'
      ? 'roof' : surface.category === 'floor' ? 'floor' : 'wall';
    const boundary = surface.boundary === 'ground'
      ? 'ground' : surface.boundary === 'outdoors' ? 'outdoors' : 'interior';
    return computeConstruction(model, surface.constructionName, orientation, boundary);
  }, [model, surface]);

  if (!surface) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="panel-header">
          <Icons.MousePointerClick className="h-3.5 w-3.5" aria-hidden />
          Selection
        </div>
        {zone ? <ZoneSummary zone={zone} /> : (
          <EmptyState
            icon={<Icons.MousePointerClick className="h-8 w-8" />}
            title="Nothing selected"
            description="Click a surface in the viewport to inspect it."
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="panel-header">
        <Icons.Square className="h-3.5 w-3.5" aria-hidden />
        Surface
      </div>

      <div className="space-y-3 p-3">
        <div>
          <div className="break-words text-sm font-medium">{surface.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="primary">{surface.category}</Badge>
            <Badge tone={surface.boundary === 'outdoors' ? 'info' : 'neutral'}>{surface.boundary}</Badge>
            {surface.sunExposed && surface.boundary === 'outdoors' && <Badge tone="warning">sun exposed</Badge>}
          </div>
        </div>

        <DetailGrid rows={[
          ['Zone', surface.zoneName || '—'],
          ['Gross area', formatArea(surface.area)],
          ['Net area', formatArea(surface.netArea)],
          ['Tilt', `${formatNumber(surface.tilt, 1)}°`],
          ['Azimuth', surface.tilt > 5 && surface.tilt < 175
            ? `${formatNumber(surface.azimuth, 1)}° (${orientationName(surface.azimuth)})`
            : '— (horizontal)'],
          ['Vertices', String(surface.vertices.length)],
          ['Height range', `${formatNumber(surface.minZ, 2)} – ${formatNumber(surface.maxZ, 2)} m`],
        ]} />

        {glazing && <GlazingEditor key={JSON.stringify(glazing.scope)} {...glazing} />}

        {construction && (
          <div>
            <div className="field-label mb-1.5">Construction</div>
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-2.5 py-1.5">
                <div className="text-xs font-medium">{construction.name}</div>
                <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground tabular">
                  <span>U {formatNumber(construction.uValue, 3)} W/m²K</span>
                  <span>R {formatNumber(construction.resistance, 2)} m²K/W</span>
                </div>
              </div>
              <ul className="divide-y divide-border/60">
                {construction.layers.map((layer, index) => (
                  <li key={`${layer.name}-${index}`} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px]">{layer.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular">
                      {layer.thickness > 0 ? `${(layer.thickness * 1000).toFixed(0)} mm` : `R ${formatNumber(layer.resistance, 2)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {surface.children.length > 0 && (
          <div>
            <div className="field-label mb-1.5">Openings ({surface.children.length})</div>
            <ul className="space-y-1">
              {surface.children.map((child) => (
                <li key={child.id} className="flex items-baseline justify-between gap-2 rounded border border-border px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px]">{child.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular">{formatArea(child.area)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {zone && <ZoneSummary zone={zone} compact />}
      </div>
    </div>
  );
}

function ZoneSummary({ zone, compact }: {
  zone: NonNullable<ReturnType<typeof useModelStore.getState>['building']>['zones'][number];
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'p-3'}>
      <div className="field-label mb-1.5">{compact ? 'Parent zone' : 'Zone'}</div>
      <div className="rounded-md border border-border p-2.5">
        <div className="text-xs font-medium">{zone.name}</div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular">
          <span>Floor {formatArea(zone.floorArea)}</span>
          <span>Volume {formatNumber(zone.volume, 0)} m³</span>
          <span>Height {formatNumber(zone.ceilingHeight, 2)} m</span>
          <span>WWR {(zone.windowToWallRatio * 100).toFixed(0)}%</span>
          <span>Surfaces {zone.surfaces.length}</span>
          <span>Multiplier {zone.multiplier}</span>
        </div>
      </div>
      {/* Only when the zone is what is selected. Shown beneath a surface it
          would be a second field labelled Glazing, one wall wide and one zone
          wide, with nothing but the hint to tell them apart. */}
      {!compact && (
        <div className="mt-2.5">
          <GlazingEditor
            key={`zone:${zone.name}`}
            label="Zone glazing"
            scope={{ kind: 'zone', zone: zone.name }}
            hint="Resizes the windows on every outward wall of this zone."
          />
        </div>
      )}
    </div>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="text-[11px] font-medium tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
