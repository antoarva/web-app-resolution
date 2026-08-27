import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeEditor, ClassicPreset, type GetSchemes } from 'rete';
import { AreaPlugin, AreaExtensions, type Area2D } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets, type ReactArea2D } from 'rete-react-plugin';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { buildSchematic, type Schematic } from './system-graph';
import { Button, Badge, EmptyState } from '@/components/ui/primitives';

type Schemes = GetSchemes<
  ClassicPreset.Node,
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>;
type AreaExtra = ReactArea2D<Schemes> | Area2D<Schemes>;

/**
 * HVAC schematic rendered as an interactive node graph.
 *
 * Rete owns the canvas imperatively, so the whole editor is torn down and
 * rebuilt when the model changes rather than diffed — the graphs here are small
 * enough that rebuilding is cheaper than reconciling.
 */
export function HvacView() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NodeEditor<Schemes>>();
  const areaRef = useRef<AreaPlugin<Schemes, AreaExtra>>();

  const model = useModelStore((state) => state.model);
  const building = useModelStore((state) => state.building);
  const dark = useUiStore((state) => state.resolvedTheme === 'dark');

  const [ready, setReady] = useState(false);
  const schematic = useMemo(() => buildSchematic(model, building), [model, building]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async (): Promise<void> => {
      const editor = new NodeEditor<Schemes>();
      const area = new AreaPlugin<Schemes, AreaExtra>(container);
      const connection = new ConnectionPlugin<Schemes, AreaExtra>();
      const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

      render.addPreset(ReactPresets.classic.setup());
      connection.addPreset(ConnectionPresets.classic.setup());

      editor.use(area);
      area.use(connection);
      area.use(render);

      AreaExtensions.simpleNodesOrder(area);
      AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
        accumulating: AreaExtensions.accumulateOnCtrl(),
      });

      await populate(editor, area, schematic);

      // The graph is a read-only depiction of the model, so block edits that
      // would put the canvas out of step with the IDF.
      editor.addPipe((context) => {
        if (['connectioncreate', 'connectionremove', 'noderemove'].includes(context.type)) return;
        return context;
      });

      if (disposed) {
        area.destroy();
        return;
      }

      editorRef.current = editor;
      areaRef.current = area;
      setReady(true);

      await AreaExtensions.zoomAt(area, editor.getNodes());
      cleanup = () => area.destroy();
    };

    void setup();

    return () => {
      disposed = true;
      setReady(false);
      cleanup?.();
      editorRef.current = undefined;
      areaRef.current = undefined;
    };
  }, [schematic]);

  const fitView = async (): Promise<void> => {
    const area = areaRef.current;
    const editor = editorRef.current;
    if (area && editor) await AreaExtensions.zoomAt(area, editor.getNodes());
  };

  if (schematic.nodes.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Workflow className="h-10 w-10" />}
        title="No system to draw"
        description="Add zones and an HVAC template to see the air path here."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <Icons.Workflow className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Air system schematic</span>
        {schematic.inferred
          ? <Badge tone="warning">inferred</Badge>
          : <Badge tone="success">from model</Badge>}
        <span className="text-xs text-muted-foreground">
          {schematic.nodes.length} components · {schematic.connections.length} connections
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void fitView()} disabled={!ready}>
            <Icons.Maximize className="h-3.5 w-3.5" aria-hidden />
            Fit
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={host}
          className="rete-host"
          style={{
            backgroundColor: dark ? 'hsl(222 47% 7%)' : 'hsl(210 40% 98%)',
            backgroundImage: `radial-gradient(circle, ${dark ? 'hsl(217 33% 20%)' : 'hsl(214 32% 88%)'} 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {schematic.inferred && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <div className="pointer-events-auto mx-auto max-w-2xl rounded-lg border border-warning/40 bg-card/95 p-3 shadow-sm backdrop-blur">
              <div className="flex items-start gap-2">
                <Icons.Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">This diagram is inferred.</span>{' '}
                  The model has no HVAC template objects, so the air path shown is the one an
                  ideal-loads system implies. Add
                  {' '}<code className="rounded bg-muted px-1">HVACTemplate:Zone:IdealLoadsAirSystem</code>{' '}
                  objects to have the diagram reflect what the file actually declares.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Creates rete nodes and connections from the derived schematic. */
async function populate(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  schematic: Schematic,
): Promise<void> {
  const socket = new ClassicPreset.Socket('air');
  const created = new Map<string, ClassicPreset.Node>();

  for (const spec of schematic.nodes) {
    const node = new ClassicPreset.Node(spec.label);

    if (spec.hasInput) node.addInput('in', new ClassicPreset.Input(socket, 'In'));
    if (spec.hasOutput) node.addOutput('out', new ClassicPreset.Output(socket, 'Out'));

    // Detail rows ride along as read-only controls, which the classic preset
    // renders as labelled inputs inside the node body.
    for (const [label, value] of spec.detail) {
      node.addControl(
        label,
        new ClassicPreset.InputControl('text', { initial: value, readonly: true }),
      );
    }

    await editor.addNode(node);
    await area.translate(node.id, spec.position);
    created.set(spec.id, node);
  }

  for (const link of schematic.connections) {
    const source = created.get(link.from);
    const target = created.get(link.to);
    if (!source || !target) continue;
    // Skip links whose endpoints lack the sockets to carry them.
    if (!source.outputs.out || !target.inputs.in) continue;

    await editor.addConnection(
      new ClassicPreset.Connection(source, 'out', target, 'in'),
    );
  }
}
