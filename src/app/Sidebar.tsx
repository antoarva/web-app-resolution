import { useMemo } from 'react';
import * as Icons from 'lucide-react';
import { NAV_ITEMS, NAV_GROUPS } from './navigation';
import { useUiStore } from '@/store/ui-store';
import { useModelStore } from '@/store/model-store';
import { useSimulationStore } from '@/store/simulation-store';
import { cn } from '@/lib/utils';

/** Resolves a lucide icon by name, falling back to a neutral glyph. */
function Icon({ name, className }: { name: string; className?: string }) {
  const Component = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <Component className={className} aria-hidden />;
}

export function Sidebar() {
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const zoneCount = useModelStore((state) => state.building?.zones.length ?? 0);
  const issueCount = useModelStore((state) => state.issues.filter((issue) => issue.severity === 'error').length);
  const simulationStatus = useSimulationStore((state) => state.status);
  const hasResults = useSimulationStore((state) => state.result !== null);

  // Small trailing indicators, so the nav reflects model state at a glance.
  const badges = useMemo(() => ({
    geometry: zoneCount > 0 ? String(zoneCount) : undefined,
    editor: issueCount > 0 ? String(issueCount) : undefined,
    results: hasResults ? '●' : undefined,
    simulation: simulationStatus === 'running' ? '…' : undefined,
  }), [zoneCount, issueCount, hasResults, simulationStatus]);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-[3.25rem]' : 'w-56',
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <Icons.Building2 className="h-4 w-4" aria-hidden />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">Envelop</div>
            <div className="truncate text-[10px] text-muted-foreground">EnergyPlus Editor</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Icons.PanelLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-1">
            {!collapsed && (
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </div>
            )}
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
              const active = view === item.id;
              const badge = badges[item.id as keyof typeof badges];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  title={collapsed ? `${item.label} — ${item.description}` : item.description}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent font-medium text-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                  )}
                >
                  {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                  <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                  {!collapsed && badge && (
                    <span className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular',
                      item.id === 'editor' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                    )}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <OfflineIndicator collapsed={collapsed} />
      </div>
    </nav>
  );
}

/** Reassures the user that nothing here needs a connection. */
function OfflineIndicator({ collapsed }: { collapsed: boolean }) {
  const engineVersion = useSimulationStore((state) => state.engineVersion);
  const engineLoaded = useSimulationStore((state) => state.engineLoaded);

  if (collapsed) {
    return (
      <div className="grid h-7 place-items-center" title={engineLoaded ? `Engine ${engineVersion} loaded` : 'Engine not loaded'}>
        <Icons.Cpu className={cn('h-4 w-4', engineLoaded ? 'text-success' : 'text-muted-foreground')} aria-hidden />
      </div>
    );
  }

  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <Icons.WifiOff className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span>Runs offline</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 rounded-full', engineLoaded ? 'bg-success' : 'bg-muted-foreground/40')} />
        <span>{engineLoaded ? `WASM engine ${engineVersion}` : 'Engine idle'}</span>
      </div>
    </div>
  );
}
