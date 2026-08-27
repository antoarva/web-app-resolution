import { useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useSimulationStore } from '@/store/simulation-store';
import { useUiStore } from '@/store/ui-store';
import { navItem } from './navigation';
import { Button, Input } from '@/components/ui/primitives';
import { serializeModel, fileHeader } from '@/core/idf/serialize';
import { downloadTextFile, cn } from '@/lib/utils';

export function TopBar() {
  const view = useUiStore((state) => state.view);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const setView = useUiStore((state) => state.setView);

  const projectName = useModelStore((state) => state.projectName);
  const setProjectName = useModelStore((state) => state.setProjectName);
  const dirty = useModelStore((state) => state.dirty);
  const busy = useModelStore((state) => state.busy);
  const save = useModelStore((state) => state.save);

  const [renaming, setRenaming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = navItem(view);

  const handleOpenFile = async (file: File): Promise<void> => {
    const text = await file.text();
    const store = useModelStore.getState();
    store.setProjectName(file.name.replace(/\.idf$/i, ''));
    await store.setSource(text);
    setView('geometry');
  };

  const handleExport = (): void => {
    const { model, projectName: name } = useModelStore.getState();
    const contents = fileHeader(name) + serializeModel(model);
    downloadTextFile(`${name.replace(/\s+/g, '_')}.idf`, contents, 'text/plain');
  };

  const cycleTheme = (): void => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };

  const themeIcon = theme === 'light' ? Icons.Sun : theme === 'dark' ? Icons.Moon : Icons.MonitorSmartphone;
  const ThemeIcon = themeIcon;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={projectName}
            className="h-7 w-56"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value) setProjectName(value);
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent"
            title="Rename project"
          >
            <span className="truncate text-sm font-medium">{projectName}</span>
            {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
            <Icons.Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </button>
        )}
        <span className="text-muted-foreground/40">/</span>
        <span className="shrink-0 text-sm text-muted-foreground">{current?.label ?? 'Envelop'}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {busy && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Parsing
          </span>
        )}

        <RunButton />

        <div className="mx-1 h-5 w-px bg-border" />

        <input
          ref={fileInput}
          type="file"
          accept=".idf,.imf,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleOpenFile(file);
            event.target.value = '';
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} title="Open an IDF file">
          <Icons.FolderOpen className="h-3.5 w-3.5" aria-hidden />
          Open
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void save()} title="Save to this browser">
          <Icons.Save className="h-3.5 w-3.5" aria-hidden />
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExport} title="Download as .idf">
          <Icons.Download className="h-3.5 w-3.5" aria-hidden />
          Export
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        <Button variant="ghost" size="icon" onClick={cycleTheme} title={`Theme: ${theme}`}>
          <ThemeIcon className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </header>
  );
}

/** Runs the engine against the current model, wherever the user is. */
function RunButton() {
  const status = useSimulationStore((state) => state.status);
  const run = useSimulationStore((state) => state.run);
  const setView = useUiStore((state) => state.setView);
  const running = status === 'running' || status === 'loading-engine';

  const handleRun = async (): Promise<void> => {
    const { model, building } = useModelStore.getState();
    if (!building) return;
    setView('simulation');
    await run(model, building);
    // Land on the results once there is something to look at.
    if (useSimulationStore.getState().status === 'complete') setView('results');
  };

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={running}
      onClick={() => void handleRun()}
      title="Run the annual simulation"
    >
      {running
        ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        : <Icons.Play className={cn('h-3.5 w-3.5')} aria-hidden />}
      {running ? 'Running' : 'Run'}
    </Button>
  );
}
