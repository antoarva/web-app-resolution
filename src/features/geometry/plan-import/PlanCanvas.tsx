/**
 * The tracing surface: one floor's image with its editable outlines over it.
 *
 * Everything the user manipulates is stored in that level's image pixel
 * coordinates, and a single pan/zoom transform maps those to the canvas.
 * Keeping outlines in image space rather than screen space is what lets the
 * scale, and therefore the building's dimensions, change without disturbing the
 * trace.
 *
 * The floor below is drawn underneath as a ghost, projected through both
 * levels' registrations, so misaligned storeys are visible while they are being
 * fixed rather than after the model is built.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Point2 } from '@/core/templates/geometry';
import { usePlanStore, activeLevel, activeLevelIndex } from '@/store/plan-store';
import { centroid, distanceToSegment, pointInPolygon, polygonArea } from '@/core/plan/polygon';
import { footprintsInLevelPixels, buildingFrameOf } from '@/core/plan/build';
import { cn } from '@/lib/utils';

/** Screen-space grab radius for vertices and the close-the-ring hotspot. */
const HANDLE_RADIUS = 6;
const HIT_RADIUS = 10;

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'vertex'; zoneId: string; index: number }
  | { kind: 'zone'; zoneId: string; lastX: number; lastY: number }
  | { kind: 'calibrate'; start: Point2 }
  | null;

export function PlanCanvas({ imageOpacity }: { imageOpacity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bitmapRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<Drag>(null);
  const pointerRef = useRef<Point2 | null>(null);
  /** The corner under the pointer, so its coordinate can be read off. */
  const hoverRef = useRef<{ zoneId: string; index: number } | null>(null);

  const spec = usePlanStore((state) => state.spec);
  const level = usePlanStore(activeLevel);
  const index = usePlanStore(activeLevelIndex);
  const tool = usePlanStore((state) => state.tool);
  const draft = usePlanStore((state) => state.draft);
  const selectedZoneId = usePlanStore((state) => state.selectedZoneId);
  const showLevelBelow = usePlanStore((state) => state.showLevelBelow);

  const toBuilding = useMemo(
    () => (level ? buildingFrameOf(spec, level.id) : null),
    [spec, level],
  );

  const image = level?.image ?? null;
  const zones = level?.zones ?? [];
  const calibration = level?.calibration ?? null;
  const scaleX = level?.metresPerPixelX ?? 0;
  const scaleY = level?.metresPerPixelY ?? 0;

  const [, forceRedraw] = useState(0);
  const redraw = useCallback(() => forceRedraw((tick) => tick + 1), []);

  // The floor below, brought into this level's pixel space for the underlay.
  const ghost = useMemo(() => {
    if (!showLevelBelow || !level || index <= 0) return [];
    return footprintsInLevelPixels(spec, spec.levels[index - 1].id, level.id);
  }, [spec, level, index, showLevelBelow]);

  // --- Load the bitmap -----------------------------------------------------
  useEffect(() => {
    if (!image) {
      bitmapRef.current = null;
      redraw();
      return;
    }
    const bitmap = new Image();
    bitmap.onload = () => {
      bitmapRef.current = bitmap;
      fitToView();
      redraw();
    };
    bitmap.src = image.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.src]);

  const fitToView = useCallback(() => {
    const wrap = wrapRef.current;
    const bitmap = bitmapRef.current;
    if (!wrap || !bitmap) return;
    const zoom = Math.min(
      wrap.clientWidth / bitmap.width,
      wrap.clientHeight / bitmap.height,
    ) * 0.92;
    viewRef.current = {
      zoom,
      panX: (wrap.clientWidth - bitmap.width * zoom) / 2,
      panY: (wrap.clientHeight - bitmap.height * zoom) / 2,
    };
  }, []);

  // --- Coordinate helpers --------------------------------------------------
  const toImage = useCallback((clientX: number, clientY: number): Point2 => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const { zoom, panX, panY } = viewRef.current;
    return [(clientX - rect.left - panX) / zoom, (clientY - rect.top - panY) / zoom];
  }, []);

  const toScreen = useCallback(([x, y]: Point2): Point2 => {
    const { zoom, panX, panY } = viewRef.current;
    return [x * zoom + panX, y * zoom + panY];
  }, []);

  // --- Painting ------------------------------------------------------------
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const { zoom, panX, panY } = viewRef.current;
    const bitmap = bitmapRef.current;
    if (bitmap) {
      context.save();
      context.globalAlpha = imageOpacity;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, panX, panY, bitmap.width * zoom, bitmap.height * zoom);
      context.restore();
    }

    // The floor below, as a dashed outline only.
    for (const ring of ghost) {
      if (ring.length < 2) continue;
      const screen = ring.map(toScreen);
      context.beginPath();
      context.moveTo(screen[0][0], screen[0][1]);
      for (let i = 1; i < screen.length; i++) context.lineTo(screen[i][0], screen[i][1]);
      context.closePath();
      context.setLineDash([5, 5]);
      context.lineWidth = 1.5;
      context.strokeStyle = 'rgba(100, 116, 139, 0.85)';
      context.stroke();
      context.setLineDash([]);
    }

    // Zone outlines.
    for (const zone of zones) {
      const selected = zone.id === selectedZoneId;
      const screen = zone.points.map(toScreen);
      if (screen.length < 2) continue;

      context.beginPath();
      context.moveTo(screen[0][0], screen[0][1]);
      for (let i = 1; i < screen.length; i++) context.lineTo(screen[i][0], screen[i][1]);
      context.closePath();
      context.fillStyle = `hsla(${zone.hue}, 75%, 50%, ${selected ? 0.26 : 0.14})`;
      context.fill();
      context.lineWidth = selected ? 2.5 : 1.5;
      context.strokeStyle = `hsl(${zone.hue}, 72%, ${selected ? 42 : 48}%)`;
      context.stroke();

      // Name and area at the centre of the ring.
      const middle = toScreen(centroid(zone.points));
      const area = polygonArea(zone.points) * scaleX * scaleY;
      context.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillStyle = 'rgba(15, 23, 42, 0.92)';
      context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      context.lineWidth = 3;
      context.strokeText(zone.name, middle[0], middle[1] - 2);
      context.fillText(zone.name, middle[0], middle[1] - 2);
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      context.strokeText(`${area.toFixed(1)} m²`, middle[0], middle[1] + 12);
      context.fillText(`${area.toFixed(1)} m²`, middle[0], middle[1] + 12);

      if (!selected) continue;

      // Edge lengths and vertex handles, only for the zone being worked on.
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      for (let i = 0; i < zone.points.length; i++) {
        const [x1, y1] = zone.points[i];
        const [x2, y2] = zone.points[(i + 1) % zone.points.length];
        const length = Math.hypot((x2 - x1) * scaleX, (y2 - y1) * scaleY);
        const mid = toScreen([(x1 + x2) / 2, (y1 + y2) / 2]);
        if (length >= 0.5) {
          const label = `${length.toFixed(length < 10 ? 2 : 1)} m`;
          context.lineWidth = 3;
          context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          context.fillStyle = 'rgba(15, 23, 42, 0.9)';
          context.strokeText(label, mid[0], mid[1]);
          context.fillText(label, mid[0], mid[1]);
        }
      }
      for (const [x, y] of screen) {
        context.beginPath();
        context.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = `hsl(${zone.hue}, 72%, 40%)`;
        context.stroke();
      }
    }

    // The ring being drawn, with a rubber band to the cursor.
    if (draft.length > 0) {
      const screen = draft.map(toScreen);
      context.beginPath();
      context.moveTo(screen[0][0], screen[0][1]);
      for (let i = 1; i < screen.length; i++) context.lineTo(screen[i][0], screen[i][1]);
      if (pointerRef.current && tool === 'draw') {
        const cursor = toScreen(pointerRef.current);
        context.lineTo(cursor[0], cursor[1]);
      }
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeStyle = '#0284c7';
      context.stroke();
      context.setLineDash([]);

      for (const [x, y] of screen) {
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fillStyle = '#0284c7';
        context.fill();
      }
      // The closing hotspot on the first vertex.
      context.beginPath();
      context.arc(screen[0][0], screen[0][1], HANDLE_RADIUS + 2, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = '#0284c7';
      context.stroke();
    }

    // Calibration line.
    const drag = dragRef.current;
    const liveCalibration = drag?.kind === 'calibrate' && pointerRef.current
      ? { start: drag.start, end: pointerRef.current, lengthMetres: calibration?.lengthMetres ?? 0 }
      : calibration;
    if (liveCalibration) {
      const start = toScreen(liveCalibration.start);
      const end = toScreen(liveCalibration.end);
      context.beginPath();
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
      context.lineWidth = 2;
      context.strokeStyle = '#f59e0b';
      context.stroke();
      for (const [x, y] of [start, end]) {
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fillStyle = '#f59e0b';
        context.fill();
      }
      const label = liveCalibration.lengthMetres > 0
        ? `${liveCalibration.lengthMetres} m` : 'set the length →';
      context.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'center';
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      context.strokeText(label, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2 - 8);
      context.fillStyle = '#b45309';
      context.fillText(label, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2 - 8);
    }

    // The corner under the pointer, with where it actually is in the building.
    const hover = hoverRef.current;
    const hoveredZone = hover ? zones.find((zone) => zone.id === hover.zoneId) : undefined;
    const corner = hoveredZone?.points[hover?.index ?? -1];
    if (hover && hoveredZone && corner && toBuilding) {
      const [x, y] = toScreen(corner);
      context.beginPath();
      context.arc(x, y, HANDLE_RADIUS + 2, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.lineWidth = 2.5;
      context.strokeStyle = `hsl(${hoveredZone.hue}, 72%, 40%)`;
      context.stroke();

      const [bx, by] = toBuilding(corner);
      const label = `${bx.toFixed(2)}, ${by.toFixed(2)} m`;
      context.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'center';
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      context.fillStyle = 'rgba(15, 23, 42, 0.95)';
      // Above the handle, unless that would run off the top of the view.
      const labelY = y - HANDLE_RADIUS - 8 < 14 ? y + HANDLE_RADIUS + 16 : y - HANDLE_RADIUS - 8;
      context.strokeText(label, x, labelY);
      context.fillText(label, x, labelY);
    }

    drawScaleBar(context, height, zoom, scaleX);
  }, [zones, ghost, draft, calibration, selectedZoneId, tool, imageOpacity, scaleX, scaleY, toScreen, toBuilding]);

  useEffect(() => {
    paint();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      paint();
      redraw();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [paint, redraw]);

  // --- Hit testing ---------------------------------------------------------
  const vertexAt = useCallback((point: Point2): { zoneId: string; index: number } | null => {
    const radius = HIT_RADIUS / viewRef.current.zoom;
    // The selected zone wins ties, so its handles stay grabbable when overlapped.
    const ordered = [...zones].sort((a, b) =>
      Number(b.id === selectedZoneId) - Number(a.id === selectedZoneId));
    for (const zone of ordered) {
      for (let position = 0; position < zone.points.length; position++) {
        const [x, y] = zone.points[position];
        if (Math.hypot(x - point[0], y - point[1]) <= radius) {
          return { zoneId: zone.id, index: position };
        }
      }
    }
    return null;
  }, [zones, selectedZoneId]);

  const edgeAt = useCallback((point: Point2): { zoneId: string; index: number } | null => {
    const radius = HIT_RADIUS / viewRef.current.zoom;
    const zone = zones.find((entry) => entry.id === selectedZoneId);
    if (!zone) return null;
    for (let position = 0; position < zone.points.length; position++) {
      const start = zone.points[position];
      const end = zone.points[(position + 1) % zone.points.length];
      if (distanceToSegment(point, start, end) <= radius) {
        return { zoneId: zone.id, index: position };
      }
    }
    return null;
  }, [zones, selectedZoneId]);

  const zoneAt = useCallback((point: Point2): string | null => {
    // Smallest hit first, so a room nested inside a block is still selectable.
    const hits = zones.filter((zone) => pointInPolygon(point, zone.points));
    if (hits.length === 0) return null;
    return hits.sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0].id;
  }, [zones]);

  // --- Pointer handling ----------------------------------------------------
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const store = usePlanStore.getState();
    const point = toImage(event.clientX, event.clientY);
    (event.target as Element).setPointerCapture(event.pointerId);

    const wantsPan = event.button === 1 || event.button === 2 || event.shiftKey;
    if (wantsPan) {
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
      return;
    }

    if (tool === 'calibrate') {
      dragRef.current = { kind: 'calibrate', start: point };
      pointerRef.current = point;
      redraw();
      return;
    }

    if (tool === 'draw') {
      // Clicking the first vertex again closes the ring.
      if (draft.length >= 3) {
        const first = draft[0];
        const distance = Math.hypot(first[0] - point[0], first[1] - point[1]);
        if (distance <= HIT_RADIUS / viewRef.current.zoom) {
          store.commitDraft();
          return;
        }
      }
      store.addDraftPoint(point);
      return;
    }

    const vertex = vertexAt(point);
    if (vertex) {
      store.selectZone(vertex.zoneId);
      if (event.altKey) {
        store.deleteVertex(vertex.zoneId, vertex.index);
        return;
      }
      store.pushHistory();
      dragRef.current = { kind: 'vertex', zoneId: vertex.zoneId, index: vertex.index };
      return;
    }

    const edge = edgeAt(point);
    if (edge && event.altKey) {
      store.insertVertex(edge.zoneId, edge.index, point);
      return;
    }

    const zoneId = zoneAt(point);
    if (zoneId) {
      store.selectZone(zoneId);
      store.pushHistory();
      dragRef.current = { kind: 'zone', zoneId, lastX: point[0], lastY: point[1] };
      return;
    }

    store.selectZone(null);
    dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = toImage(event.clientX, event.clientY);
    pointerRef.current = point;
    const drag = dragRef.current;
    const store = usePlanStore.getState();

    if (!drag) {
      const over = tool === 'select' ? vertexAt(point) : null;
      const was = hoverRef.current;
      if (over?.zoneId !== was?.zoneId || over?.index !== was?.index) {
        hoverRef.current = over;
        redraw();
      }
      if (tool === 'draw' && draft.length > 0) redraw();
      return;
    }

    if (drag.kind === 'pan') {
      viewRef.current.panX += event.clientX - drag.lastX;
      viewRef.current.panY += event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      redraw();
      return;
    }
    if (drag.kind === 'vertex') {
      // Keep the readout on the corner being moved, so the number changes with
      // it rather than disappearing the moment it is picked up.
      hoverRef.current = { zoneId: drag.zoneId, index: drag.index };
      store.moveVertex(drag.zoneId, drag.index, point);
      return;
    }
    if (drag.kind === 'zone') {
      store.translateZone(drag.zoneId, point[0] - drag.lastX, point[1] - drag.lastY);
      drag.lastX = point[0];
      drag.lastY = point[1];
      return;
    }
    redraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    const store = usePlanStore.getState();

    if (drag?.kind === 'calibrate') {
      const end = toImage(event.clientX, event.clientY);
      const pixels = Math.hypot(end[0] - drag.start[0], end[1] - drag.start[1]);
      if (pixels * viewRef.current.zoom >= 8) {
        // Keep the length already entered so re-measuring does not reset it.
        const length = calibration?.lengthMetres || 10;
        store.applyCalibration({ start: drag.start, end, lengthMetres: length });
        store.setTool('select');
      }
      redraw();
      return;
    }
    if (drag?.kind === 'vertex' || drag?.kind === 'zone') store.commitEdit();
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const view = viewRef.current;

    const factor = Math.exp(-event.deltaY * 0.0015);
    const zoom = Math.max(0.02, Math.min(40, view.zoom * factor));
    // Anchor the zoom on the cursor so the plan does not slide away.
    view.panX = cursorX - ((cursorX - view.panX) / view.zoom) * zoom;
    view.panY = cursorY - ((cursorY - view.panY) / view.zoom) * zoom;
    view.zoom = zoom;
    redraw();
  };

  const handleDoubleClick = (): void => {
    if (tool === 'draw') usePlanStore.getState().commitDraft();
  };

  // --- Keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const store = usePlanStore.getState();

      if (event.key === 'Enter' && store.draft.length >= 3) {
        event.preventDefault();
        store.commitDraft();
      } else if (event.key === 'Escape') {
        if (store.draft.length > 0) {
          event.preventDefault();
          store.cancelDraft();
        }
      } else if (event.key === 'Backspace' && store.draft.length > 0) {
        event.preventDefault();
        store.cancelDraft();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && store.selectedZoneId) {
        event.preventDefault();
        store.removeZone(store.selectedZoneId);
      } else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        store.undo();
      } else if (event.key.toLowerCase() === 'f') {
        fitToView();
        redraw();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        // Page through the stack the way the floors are ordered.
        const step = event.key === 'PageUp' ? 1 : -1;
        const position = activeLevelIndex(store) + step;
        const next = store.spec.levels[position];
        if (next) {
          event.preventDefault();
          store.setActiveLevel(next.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitToView, redraw]);

  if (!level) return null;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-muted/40">
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 touch-none',
          tool === 'draw' && 'cursor-crosshair',
          tool === 'calibrate' && 'cursor-crosshair',
          tool === 'select' && 'cursor-default',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          pointerRef.current = null;
          if (hoverRef.current) {
            hoverRef.current = null;
            redraw();
          }
        }}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />

      {!image && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            {level.name} has no image. Draw its outline, or copy the floor below.
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
        <div className="rounded-md border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          {tool === 'draw' && 'Click to place corners · click the first corner or press Enter to close · Esc to cancel'}
          {tool === 'calibrate' && 'Drag along a dimension you know, then type its length in the panel'}
          {tool === 'select' && 'Drag a zone or its corners · Alt-click a corner to delete, an edge to add · scroll to zoom · F to fit · PgUp/PgDn for floors'}
        </div>
      </div>
    </div>
  );
}

/** A rounded scale bar, so the current dimensions are readable at a glance. */
function drawScaleBar(
  context: CanvasRenderingContext2D, height: number, zoom: number, metresPerPixel: number,
): void {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return;
  const metresPerScreenPixel = metresPerPixel / zoom;
  const targetMetres = metresPerScreenPixel * 120;
  const magnitude = 10 ** Math.floor(Math.log10(targetMetres));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude)
    .find((candidate) => candidate >= targetMetres) ?? magnitude * 10;
  const pixels = step / metresPerScreenPixel;

  const x = 16;
  const y = height - 22;
  context.save();
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(15, 23, 42, 0.75)';
  context.beginPath();
  context.moveTo(x, y - 5);
  context.lineTo(x, y);
  context.lineTo(x + pixels, y);
  context.lineTo(x + pixels, y - 5);
  context.stroke();
  context.font = '11px ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'left';
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.strokeText(`${step} m`, x, y - 8);
  context.fillStyle = 'rgba(15, 23, 42, 0.85)';
  context.fillText(`${step} m`, x, y - 8);
  context.restore();
}
