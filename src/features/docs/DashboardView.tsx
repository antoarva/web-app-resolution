import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { usePlanStore } from '@/store/plan-store';
import { useSimulationStore, annualTotals } from '@/store/simulation-store';
import { TEMPLATES } from '@/core/templates/buildings';
import { CLIMATE_LOCATIONS, findLocation } from '@/core/model/climate';
import {
  listProjects, deleteProject, storageEstimate, type StoredProject,
} from '@/lib/persistence';
import { Button, Badge, StatTile, Card, Select } from '@/components/ui/primitives';
import { formatArea, formatNumber, formatBytes, cn } from '@/lib/utils';

/** Landing view: what the model is, what you can start from, what you saved. */
export function DashboardView() {
  const building = useModelStore((state) => state.building);
  const projectName = useModelStore((state) => state.projectName);
  const objectCount = useModelStore((state) => state.model.objects.length);
  const issues = useModelStore((state) => state.issues);
  const locationId = useModelStore((state) => state.locationId);
  const loadTemplate = useModelStore((state) => state.loadTemplate);
  const loadProject = useModelStore((state) => state.loadProject);
  const setView = useUiStore((state) => state.setView);
  const openPlanImport = usePlanStore((state) => state.setOpen);
  const result = useSimulationStore((state) => state.result);

  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [templateLocation, setTemplateLocation] = useState(locationId);

  const refreshProjects = async (): Promise<void> => {
    setProjects(await listProjects());
    setStorage(await storageEstimate());
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  const totals = annualTotals(result);
  const floorArea = building?.totals.floorArea ?? 0;
  const eui = floorArea > 0 ? totals.total / floorArea : 0;
  const errors = issues.filter((issue) => issue.severity === 'error').length;

  const handleTemplate = async (templateId: string): Promise<void> => {
    await loadTemplate(templateId, templateLocation);
    setView('geometry');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">{projectName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {building
              ? `${building.zones.length} zones · ${objectCount} objects · ${findLocation(locationId)?.city ?? building.site.name}`
              : 'No model loaded'}
          </p>
        </div>

        {/* Model at a glance */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Floor area" value={formatNumber(floorArea, 0)} unit="m²"
            detail={building ? `${building.zones.length} thermal zones` : undefined}
          />
          <StatTile
            label="Window-to-wall" value={formatNumber((building?.totals.windowToWallRatio ?? 0) * 100, 0)} unit="%"
            detail={building ? formatArea(building.totals.windowArea) + ' glazing' : undefined}
            tone={(building?.totals.windowToWallRatio ?? 0) > 0.5 ? 'warning' : 'neutral'}
          />
          <StatTile
            label="Volume" value={formatNumber(building?.totals.volume ?? 0, 0)} unit="m³"
            detail={building ? `${building.totals.surfaceCount} surfaces` : undefined}
          />
          <StatTile
            label={result ? 'Energy use intensity' : 'Model status'}
            value={result ? formatNumber(eui, 1) : errors > 0 ? String(errors) : 'Valid'}
            unit={result ? 'kWh/m²·yr' : errors > 0 ? 'errors' : undefined}
            detail={result ? 'from the last run' : errors > 0 ? 'see the editor' : 'ready to run'}
            tone={result ? (eui < 80 ? 'success' : eui > 200 ? 'warning' : 'primary') : errors > 0 ? 'danger' : 'success'}
          />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="md" onClick={() => setView('geometry')}>
            <Icons.Box className="h-4 w-4" aria-hidden />
            View geometry
          </Button>
          <Button variant="outline" size="md" onClick={() => setView('simulation')}>
            <Icons.Play className="h-4 w-4" aria-hidden />
            Run simulation
          </Button>
          <Button variant="outline" size="md" onClick={() => setView('editor')}>
            <Icons.FileCode className="h-4 w-4" aria-hidden />
            Edit the IDF
          </Button>
          <Button variant="outline" size="md" onClick={() => setView('docs')}>
            <Icons.BookOpen className="h-4 w-4" aria-hidden />
            How this works
          </Button>
        </div>

        {/* Templates */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Start from a template</h2>
              <p className="text-xs text-muted-foreground">
                Each one generates a complete, valid IDF file you can edit and run immediately.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Location</span>
              <Select
                value={templateLocation}
                onChange={(event) => setTemplateLocation(event.target.value)}
                className="h-8 w-44 text-xs"
              >
                {CLIMATE_LOCATIONS.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.city} ({location.zone})
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => void handleTemplate(template.id)}
                className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <TemplateIcon category={template.category} />
                  <Icons.ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </div>
                <h3 className="mt-2.5 text-sm font-medium">{template.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{template.category}</Badge>
                  <Badge tone="neutral">{template.zoneCount} zones</Badge>
                  <Badge tone="neutral">{template.floorArea} m²</Badge>
                </div>
              </button>
            ))}

            {/* The templates are fixed shapes; this one takes its shape from a
                drawing you already have. */}
            <button
              type="button"
              onClick={() => openPlanImport(true)}
              className="group rounded-lg border border-dashed border-primary/50 bg-primary/[0.04] p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="rounded-md bg-primary/10 p-1.5 text-primary">
                  <Icons.Layers2 className="h-4 w-4" aria-hidden />
                </div>
                <Icons.ArrowRight
                  className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden
                />
              </div>
              <h3 className="mt-2.5 text-sm font-medium">From floor images</h3>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                Drop one plan image per floor. Each is traced, scaled and stacked into 3D
                geometry you can resize afterwards.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Badge tone="primary">Your plans</Badge>
                <Badge tone="neutral">Any shape</Badge>
                <Badge tone="neutral">Multi-storey</Badge>
              </div>
            </button>
          </div>
        </section>

        {/* Saved projects */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Saved in this browser</h2>
              <p className="text-xs text-muted-foreground">
                Projects live in IndexedDB on this device. Nothing is uploaded anywhere.
              </p>
            </div>
            {storage && storage.quota > 0 && (
              <span className="text-[11px] text-muted-foreground tabular">
                {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
              </span>
            )}
          </div>

          {projects.length === 0 ? (
            <Card className="text-center">
              <Icons.Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden />
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing saved yet. Use <span className="font-medium text-foreground">Save</span> in
                the toolbar to keep a project here.
              </p>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {projects.map((project) => (
                  <li key={project.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30">
                    <Icons.FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <button
                      type="button"
                      onClick={() => void loadProject(project).then(() => setView('geometry'))}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium">{project.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular">
                        {new Date(project.updatedAt).toLocaleString()} · {formatBytes(project.size)}
                        {' · '}{findLocation(project.locationId)?.city ?? 'unknown site'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteProject(project.id).then(refreshProjects)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                      title="Delete project"
                    >
                      <Icons.Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Offline note */}
        <Card className="bg-muted/30">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success/15">
              <Icons.WifiOff className="h-4 w-4 text-success" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium">This app runs entirely offline</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Parsing, geometry and the annual heat balance all execute in a WebAssembly module
                bundled with the page. There is no server, no API, and no request goes out once the
                app has loaded — disconnect the network and everything still works. Your models are
                stored locally in this browser.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TemplateIcon({ category }: { category: string }) {
  const map: Record<string, { icon: Icons.LucideIcon; className: string }> = {
    Office: { icon: Icons.Building2, className: 'bg-chart-1/15 text-chart-1' },
    Residential: { icon: Icons.Home, className: 'bg-chart-3/15 text-chart-3' },
    Retail: { icon: Icons.Store, className: 'bg-chart-5/15 text-chart-5' },
    Industrial: { icon: Icons.Warehouse, className: 'bg-chart-4/15 text-chart-4' },
    Education: { icon: Icons.GraduationCap, className: 'bg-chart-6/15 text-chart-6' },
  };
  const entry = map[category] ?? map.Office;
  const Icon = entry.icon;
  return (
    <div className={cn('grid h-9 w-9 place-items-center rounded-lg', entry.className)}>
      <Icon className="h-4.5 w-4.5" aria-hidden />
    </div>
  );
}
