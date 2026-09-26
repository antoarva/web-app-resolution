import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as Icons from 'lucide-react';
import { useModelStore } from '@/store/model-store';
import { useUiStore } from '@/store/ui-store';
import { usePlanStore } from '@/store/plan-store';
import {
  buildSurfaceGroup, buildGrid, buildLighting, frameCamera,
  LIGHT_COLORS, DARK_COLORS, type ColorMode,
} from './scene';
import { Button, EmptyState, Toggle } from '@/components/ui/primitives';
import { SurfaceInspector } from './SurfaceInspector';
import { GeometrySpecPanel } from './GeometrySpecPanel';
import { formatArea, cn } from '@/lib/utils';

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'surface-type', label: 'Surface type' },
  { id: 'zone', label: 'Zone' },
  { id: 'construction', label: 'Construction' },
  { id: 'orientation', label: 'Orientation' },
];

export function GeometryView() {
  const mount = useRef<HTMLDivElement>(null);
  const building = useModelStore((state) => state.building);
  const selection = useModelStore((state) => state.selection);
  const select = useModelStore((state) => state.select);

  const openPlanImport = usePlanStore((state) => state.setOpen);

  const dark = useUiStore((state) => state.resolvedTheme === 'dark');
  const showGrid = useUiStore((state) => state.showGrid);
  const showEdges = useUiStore((state) => state.showEdges);
  const setShowGrid = useUiStore((state) => state.setShowGrid);
  const setShowEdges = useUiStore((state) => state.setShowEdges);

  const [colorMode, setColorMode] = useState<ColorMode>('surface-type');
  const [hovered, setHovered] = useState<{ name: string; zone: string; area: number } | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);

  // Long-lived Three.js objects live in refs: they must survive re-renders and
  // be disposed explicitly, which React state cannot express.
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<OrbitControls>();
  const contentRef = useRef<THREE.Group>();
  const pickTargetsRef = useRef<THREE.Mesh[]>([]);
  const frameRef = useRef<number>();
  /** Extents of the model the camera was last framed on. */
  const framedExtentsRef = useRef<string>('');

  // --- Renderer setup, once per mount ---
  useEffect(() => {
    const container = mount.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 5000,
    );
    // IDF geometry is Z-up.
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI;

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const renderLoop = (): void => {
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);

      // These two refs describe the scene and camera created above, so they
      // must not outlive them. StrictMode remounts this effect in development,
      // and a stale "already framed" signature would leave the *new* camera
      // sitting unframed at the origin — the scene renders nothing even though
      // its meshes are still there and still pickable.
      contentRef.current = undefined;
      framedExtentsRef.current = '';
    };
  }, []);

  // --- Rebuild content when the model or display options change ---
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls || !building) return;

    scene.background = new THREE.Color(dark ? 0x0b1220 : 0xeef2f6);

    // Dispose the previous content before replacing it: geometries and
    // materials are not garbage collected by Three on their own.
    if (contentRef.current) {
      contentRef.current.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
      scene.remove(contentRef.current);
    }

    const content = new THREE.Group();
    content.add(buildLighting(dark));
    if (showGrid) content.add(buildGrid(building, dark));

    // Zone filter and selection both drive which surfaces stay lit.
    const highlighted = new Set<string>();
    if (zoneFilter) {
      const zone = building.zones.find((entry) => entry.name === zoneFilter);
      for (const surface of zone?.surfaces ?? []) {
        highlighted.add(surface.id);
        for (const child of surface.children) highlighted.add(child.id);
      }
    }

    const { group, pickTargets } = buildSurfaceGroup(building, {
      colors: dark ? DARK_COLORS : LIGHT_COLORS,
      mode: colorMode,
      showEdges,
      highlighted,
    });
    content.add(group);
    scene.add(content);
    contentRef.current = content;
    pickTargetsRef.current = pickTargets;

    // Only reframe when the model's extents actually changed, so toggling a
    // display option does not yank the camera back.
    const signature = building.bounds.size.join(',');
    if (framedExtentsRef.current !== signature) {
      frameCamera(camera, controls.target, building);
      framedExtentsRef.current = signature;
      controls.update();
    }
  }, [building, dark, showGrid, showEdges, colorMode, zoneFilter]);

  // --- Selection highlight ---
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const selectedId = selection.surfaceId;

    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshLambertMaterial;
      if (!material.emissive) return;
      const isSelected = selectedId !== null && object.userData.surfaceId === selectedId;
      material.emissive.setHex(isSelected ? 0x0284c7 : 0x000000);
      material.emissiveIntensity = isSelected ? 0.6 : 0;
    });
  }, [selection.surfaceId, building]);

  // --- Picking ---
  const pick = useCallback((event: React.MouseEvent<HTMLDivElement>): THREE.Intersection | null => {
    const container = mount.current;
    const camera = cameraRef.current;
    if (!container || !camera) return null;

    const rect = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickTargetsRef.current, false);
    return hits[0] ?? null;
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const hit = pick(event);
    if (!hit) {
      select({ surfaceId: null, objectId: null });
      return;
    }
    const data = hit.object.userData;
    select({ surfaceId: data.surfaceId, objectId: data.surfaceId, zoneName: data.zoneName });
  };

  const handleMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const hit = pick(event);
    if (!hit) {
      if (hovered) setHovered(null);
      return;
    }
    const data = hit.object.userData;
    if (hovered?.name !== data.surfaceName) {
      setHovered({ name: data.surfaceName, zone: data.zoneName, area: data.area });
    }
  };

  const resetCamera = (): void => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || !building) return;
    frameCamera(camera, controls.target, building);
    controls.update();
  };

  if (!building || building.zones.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Box className="h-10 w-10" />}
        title="No geometry to show"
        description="This model has no zones with surfaces yet. Load a template from the Overview, trace one from your floor plan images, or open an existing IDF file."
        action={(
          <Button variant="primary" size="md" onClick={() => openPlanImport(true)}>
            <Icons.Layers2 className="h-4 w-4" aria-hidden />
            Trace from floor images
          </Button>
        )}
      />
    );
  }

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <div
          ref={mount}
          className="absolute inset-0 cursor-crosshair"
          onClick={handleClick}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        />

        {/* Floating controls */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
            {COLOR_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setColorMode(mode.id)}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors',
                  colorMode === mode.id
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <Button variant="outline" size="md" onClick={() => openPlanImport(true)} title="Build geometry by tracing one plan image per floor">
              <Icons.Layers2 className="h-4 w-4" aria-hidden />
              From images
            </Button>
            <Button variant="outline" size="icon" onClick={resetCamera} title="Reset view">
              <Icons.Maximize className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Zone filter chips */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoneFilter(null)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur transition-colors',
                zoneFilter === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card/95 text-muted-foreground hover:text-foreground',
              )}
            >
              All zones
            </button>
            {building.zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => setZoneFilter(zoneFilter === zone.name ? null : zone.name)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur transition-colors',
                  zoneFilter === zone.name
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card/95 text-muted-foreground hover:text-foreground',
                )}
              >
                {zone.name}
              </button>
            ))}
          </div>
        </div>

        {/* Hover readout */}
        {hovered && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-border bg-popover/95 px-3 py-1.5 text-xs shadow-md backdrop-blur">
            <span className="font-medium">{hovered.name}</span>
            {hovered.zone && <span className="text-muted-foreground"> · {hovered.zone}</span>}
            <span className="text-muted-foreground"> · {formatArea(hovered.area)}</span>
          </div>
        )}
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
        <GeometrySpecPanel />
        <div className="panel-header">
          <Icons.SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          View
        </div>
        <div className="shrink-0 space-y-3 border-b border-border p-3">
          <Toggle checked={showGrid} onChange={setShowGrid} label="Ground grid" />
          <Toggle checked={showEdges} onChange={setShowEdges} label="Surface edges" />
        </div>
        <SurfaceInspector />
      </aside>
    </div>
  );
}
