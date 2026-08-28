/**
 * State for the image-to-geometry importer.
 *
 * The traced plan lives here rather than in the model store because it is a
 * *source* for a model, not a projection of one: the IDF is generated from it
 * on demand, and the plan survives afterwards so the dimensions can be changed
 * and the model regenerated. It is mirrored into IndexedDB for the same reason
 * projects are — there is nowhere else for it to go.
 *
 * A plan holds one level per floor image. Dropping a folder of floor plans is
 * the fast path: each image becomes a level, is traced, and is registered
 * against the level below, which is enough to stand a building up.
 */

import { create } from 'zustand';
import type { Point2 } from '@/core/templates/geometry';
import {
  emptyPlan, emptyLevel, newZoneId, findProgram, registerAgainst,
  type PlanSpec, type PlanLevel, type PlanZone, type Calibration,
  type ImageSource, type ProgramId,
} from '@/core/plan/types';
import {
  loadAnalysisImage, traceImage, decode,
  DEFAULT_TRACE_OPTIONS, type AnalysisImage, type TraceOptions,
} from '@/core/plan/trace';
import {
  scaleToExtents, resizeZone, applyLevelScale, alignLevelTo, moveLevel as offsetLevel,
} from '@/core/plan/build';
import { boundsOfAll, simplifyRing, orthogonalize } from '@/core/plan/polygon';
import { loadPlan, savePlan, clearPlan, type StoredPlan } from '@/lib/persistence';
import { DEFAULT_LOCATION_ID } from '@/core/model/climate';

export type PlanTool = 'select' | 'draw' | 'calibrate';

const UNDO_LIMIT = 40;
/** Per-image cap. Data URLs above this hurt both memory and IndexedDB. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Cap across every level, so a deep stack cannot fill the origin's quota. */
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;
/** A first guess at building width, so a fresh trace is not five metres wide. */
const DEFAULT_BUILDING_WIDTH = 30;

interface PlanState {
  open: boolean;
  spec: PlanSpec;
  /** Downscaled luminance rasters by level id, rebuilt on load, not persisted. */
  analysis: Record<string, AnalysisImage>;
  traceOptions: TraceOptions;

  tool: PlanTool;
  activeLevelId: string | null;
  selectedZoneId: string | null;
  /** Vertices placed so far in the drawing tool, in image pixels. */
  draft: Point2[];
  /** Draws the level below as a ghost, for registering one floor over another. */
  showLevelBelow: boolean;
  busy: boolean;
  /** What the importer is working on, shown while a batch import runs. */
  progress: string | null;
  error: string | null;
  hydrated: boolean;

  history: PlanLevel[][];

  setOpen(open: boolean): void;
  hydrate(): Promise<void>;

  addLevelsFromFiles(files: FileList | File[]): Promise<void>;
  replaceLevelImage(levelId: string, file: File): Promise<void>;
  addEmptyLevel(): void;
  duplicateLevel(levelId: string): void;
  removeLevel(levelId: string): void;
  reorderLevel(levelId: string, direction: -1 | 1): void;
  setActiveLevel(id: string): void;
  updateLevel(id: string, patch: Partial<PlanLevel>): void;
  alignToLevelBelow(levelId: string): void;
  nudgeLevel(levelId: string, dx: number, dy: number): void;
  clearPlanEntirely(): Promise<void>;
  setShowLevelBelow(show: boolean): void;

  setTool(tool: PlanTool): void;
  selectZone(id: string | null): void;

  setTraceOptions(patch: Partial<TraceOptions>): void;
  autoTrace(levelId?: string): Promise<void>;
  autoTraceAll(): Promise<void>;

  addDraftPoint(point: Point2): void;
  commitDraft(): void;
  cancelDraft(): void;

  updateZone(id: string, patch: Partial<PlanZone>): void;
  moveVertex(id: string, index: number, point: Point2): void;
  insertVertex(id: string, index: number, point: Point2): void;
  deleteVertex(id: string, index: number): void;
  translateZone(id: string, dx: number, dy: number): void;
  removeZone(id: string): void;
  duplicateZone(id: string): void;
  simplifySelected(): void;
  squareUpSelected(): void;
  copyZonesFromBelow(): void;
  clearZones(): void;
  /** Snapshots the current outlines so a drag can be undone as one step. */
  pushHistory(): void;
  /** Writes the plan to storage after a live edit has settled. */
  commitEdit(): void;
  undo(): void;

  updateSpec(patch: Partial<PlanSpec>): void;
  setProgram(program: ProgramId): void;
  setExtents(width: number | null, depth: number | null): void;
  setZoneExtents(id: string, width: number | null, depth: number | null): void;
  applyCalibration(calibration: Calibration): void;
  setCalibrationLength(lengthMetres: number): void;
}

function persist(state: PlanState): void {
  if (state.spec.levels.length === 0) {
    void clearPlan();
    return;
  }
  const record: StoredPlan = { spec: state.spec, updatedAt: Date.now() };
  void savePlan(record);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** Distinct hues, so adjacent zones never come out the same colour. */
function hueFor(index: number): number {
  return (index * 137.508) % 360;
}

/**
 * Floor plans are usually named in storey order, and "Floor 10" must not sort
 * before "Floor 2", so digit runs are compared as numbers.
 */
function byNaturalName(a: File, b: File): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function totalImageBytes(spec: PlanSpec): number {
  return spec.levels.reduce((sum, level) => sum + (level.image?.src.length ?? 0), 0);
}

/** Reads one file into the shape a level needs, or throws with a usable reason. */
async function readImage(file: File): Promise<ImageSource> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image. PNG, JPEG, WebP and SVG all work.`);
  }
  const src = await readAsDataUrl(file);
  if (src.length > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name} is over 12 MB. Downscale it and try again.`);
  }
  const bitmap = await decode(src);
  return { src, name: file.name, width: bitmap.width, height: bitmap.height };
}

export const usePlanStore = create<PlanState>((set, get) => ({
  open: false,
  spec: emptyPlan(DEFAULT_LOCATION_ID),
  analysis: {},
  traceOptions: DEFAULT_TRACE_OPTIONS,

  tool: 'select',
  activeLevelId: null,
  selectedZoneId: null,
  draft: [],
  showLevelBelow: true,
  busy: false,
  progress: null,
  error: null,
  hydrated: false,

  history: [],

  setOpen(open) {
    set({ open, draft: [], error: null });
    if (open && !get().hydrated) void get().hydrate();
  },

  async hydrate() {
    const stored = await loadPlan();
    if (!stored) {
      set({ hydrated: true });
      return;
    }
    set({ hydrated: true, busy: true, spec: stored.spec,
      activeLevelId: stored.spec.levels[0]?.id ?? null });

    // Rasters are derived, so they are rebuilt here rather than stored.
    const analysis: Record<string, AnalysisImage> = {};
    for (const level of stored.spec.levels) {
      if (!level.image) continue;
      try {
        analysis[level.id] = await loadAnalysisImage(level.image.src);
      } catch {
        // A level whose image will not decode keeps its numbers and outlines.
      }
    }
    set({ analysis, busy: false });
  },

  async addLevelsFromFiles(files) {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) {
      set({ error: 'No images in that drop. PNG, JPEG, WebP and SVG all work.' });
      return;
    }
    list.sort(byNaturalName);

    set({ busy: true, error: null, progress: `Reading ${list.length} image${list.length === 1 ? '' : 's'}…` });
    try {
      let spec = get().spec;
      const analysis = { ...get().analysis };
      const added: PlanLevel[] = [];
      const skipped: string[] = [];

      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        set({ progress: `Reading ${file.name} (${i + 1} of ${list.length})…` });
        let image: ImageSource;
        try {
          image = await readImage(file);
        } catch (cause) {
          skipped.push(cause instanceof Error ? cause.message : String(cause));
          continue;
        }
        if (totalImageBytes(spec) + image.src.length > MAX_TOTAL_IMAGE_BYTES) {
          skipped.push(`${file.name} would push the plan over the 48 MB storage budget.`);
          continue;
        }

        // `spec` already grows with each accepted image, so it alone counts the
        // levels — adding `added.length` here would number them 2, 4, 6.
        let level = emptyLevel(`Level ${spec.levels.length + 1}`, image);
        // Register each new floor against the one below, so a stack of exports
        // of the same drawing lines up without any manual alignment.
        const reference = added[added.length - 1] ?? spec.levels[spec.levels.length - 1];
        if (reference) level = registerAgainst(level, reference);

        analysis[level.id] = await loadAnalysisImage(image.src);
        added.push(level);
        spec = { ...spec, levels: [...spec.levels, level] };
      }

      if (added.length === 0) {
        set({ busy: false, progress: null, error: skipped[0] ?? 'None of those images could be read.' });
        return;
      }

      set({
        spec,
        analysis,
        activeLevelId: get().activeLevelId ?? added[0].id,
        busy: false,
        progress: null,
        error: skipped.length > 0 ? skipped.join(' ') : null,
        history: [...get().history, get().spec.levels].slice(-UNDO_LIMIT),
      });

      // Trace what was just imported. This is the "drop the floors in and get a
      // building" path, so it runs without being asked.
      await get().autoTraceAll();
    } catch (cause) {
      set({ busy: false, progress: null, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  async replaceLevelImage(levelId, file) {
    set({ busy: true, error: null });
    try {
      const image = await readImage(file);
      const analysis = { ...get().analysis, [levelId]: await loadAnalysisImage(image.src) };
      set({
        analysis,
        busy: false,
        spec: {
          ...get().spec,
          levels: get().spec.levels.map((level) => (level.id === levelId
            ? { ...level, image, zones: [] } : level)),
        },
      });
      persist(get());
      await get().autoTrace(levelId);
    } catch (cause) {
      set({ busy: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  addEmptyLevel() {
    const { spec } = get();
    const previous = spec.levels[spec.levels.length - 1];
    let level = emptyLevel(`Level ${spec.levels.length + 1}`, previous?.image ?? null);
    if (previous) level = registerAgainst(level, previous);
    set({
      history: [...get().history, spec.levels].slice(-UNDO_LIMIT),
      spec: { ...spec, levels: [...spec.levels, level] },
      activeLevelId: level.id,
      selectedZoneId: null,
    });
    // The new level shares the previous level's raster, so detection still works.
    if (previous && get().analysis[previous.id]) {
      set({ analysis: { ...get().analysis, [level.id]: get().analysis[previous.id] } });
    }
    persist(get());
  },

  duplicateLevel(levelId) {
    const { spec } = get();
    const index = spec.levels.findIndex((level) => level.id === levelId);
    if (index === -1) return;
    const source = spec.levels[index];

    const copy: PlanLevel = {
      ...source,
      id: emptyLevel('', null).id,
      name: `Level ${spec.levels.length + 1}`,
      zones: source.zones.map((zone) => ({ ...zone, id: newZoneId() })),
    };
    const levels = spec.levels.slice();
    levels.splice(index + 1, 0, copy);

    set({
      history: [...get().history, spec.levels].slice(-UNDO_LIMIT),
      spec: { ...spec, levels },
      activeLevelId: copy.id,
      analysis: { ...get().analysis, [copy.id]: get().analysis[source.id] },
    });
    persist(get());
  },

  removeLevel(levelId) {
    const { spec } = get();
    const levels = spec.levels.filter((level) => level.id !== levelId);
    if (levels.length === spec.levels.length) return;

    const analysis = { ...get().analysis };
    delete analysis[levelId];
    set({
      history: [...get().history, spec.levels].slice(-UNDO_LIMIT),
      spec: { ...spec, levels },
      analysis,
      activeLevelId: get().activeLevelId === levelId ? levels[0]?.id ?? null : get().activeLevelId,
      selectedZoneId: null,
    });
    persist(get());
  },

  reorderLevel(levelId, direction) {
    const { spec } = get();
    const index = spec.levels.findIndex((level) => level.id === levelId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= spec.levels.length) return;

    const levels = spec.levels.slice();
    [levels[index], levels[target]] = [levels[target], levels[index]];
    set({
      history: [...get().history, spec.levels].slice(-UNDO_LIMIT),
      spec: { ...spec, levels },
    });
    persist(get());
  },

  setActiveLevel(id) {
    set({ activeLevelId: id, selectedZoneId: null, draft: [] });
  },

  updateLevel(id, patch) {
    const { spec } = get();
    set({
      spec: {
        ...spec,
        levels: spec.levels.map((level) => (level.id === id ? { ...level, ...patch } : level)),
      },
    });
    persist(get());
  },

  alignToLevelBelow(levelId) {
    const { spec } = get();
    const index = spec.levels.findIndex((level) => level.id === levelId);
    if (index <= 0) return;
    set({ spec: alignLevelTo(spec, levelId, spec.levels[index - 1].id) });
    persist(get());
  },

  nudgeLevel(levelId, dx, dy) {
    set({ spec: offsetLevel(get().spec, levelId, dx, dy) });
    persist(get());
  },

  async clearPlanEntirely() {
    await clearPlan();
    set({
      spec: { ...emptyPlan(get().spec.locationId), program: get().spec.program },
      analysis: {},
      activeLevelId: null,
      selectedZoneId: null,
      draft: [],
      history: [],
      error: null,
    });
  },

  setShowLevelBelow(show) {
    set({ showLevelBelow: show });
  },

  setTool(tool) {
    set({ tool, draft: tool === 'draw' ? get().draft : [] });
  },

  selectZone(id) {
    set({ selectedZoneId: id });
  },

  setTraceOptions(patch) {
    set({ traceOptions: { ...get().traceOptions, ...patch } });
  },

  async autoTrace(levelId) {
    const id = levelId ?? get().activeLevelId;
    if (!id) return;
    const raster = get().analysis[id];
    if (!raster) {
      set({ error: 'This level has no image to detect from.' });
      return;
    }

    set({ busy: true, error: null });
    // Yield a frame so the button's busy state paints before the scan blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const shapes = traceImage(raster, get().traceOptions);
      if (shapes.length === 0) {
        set({ busy: false, error: 'Nothing was found at this threshold. Try moving it, or invert for a dark plan.' });
        return;
      }
      applyShapes(id, shapes);
      set({ busy: false, selectedZoneId: null });
      persist(get());
    } catch (cause) {
      set({ busy: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  async autoTraceAll() {
    const { spec } = get();
    const levels = spec.levels.filter((level) => get().analysis[level.id]);
    if (levels.length === 0) return;

    set({ busy: true, error: null, history: [...get().history, spec.levels].slice(-UNDO_LIMIT) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failed: string[] = [];
    try {
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        set({ progress: `Tracing ${level.name} (${i + 1} of ${levels.length})…` });
        // Yield between levels so the progress line actually paints.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const shapes = traceImage(get().analysis[level.id], get().traceOptions);
        if (shapes.length === 0) {
          failed.push(level.name);
          continue;
        }
        applyShapes(level.id, shapes);
      }

      // One scale for the whole stack, seeded only while it is still at the
      // meaningless default, so re-tracing never undoes a measured scale.
      const untouched = get().spec.levels.every(
        (level) => level.metresPerPixelX === 0.05 && level.calibration === null,
      );
      if (untouched) {
        const first = get().spec.levels.find((level) => level.zones.length > 0);
        if (first) {
          const box = boundsOfAll(first.zones.map((zone) => zone.points));
          if (box.width > 0) {
            set({ spec: scaleToExtents(get().spec, DEFAULT_BUILDING_WIDTH, null) });
          }
        }
      }

      set({
        busy: false,
        progress: null,
        error: failed.length > 0
          ? `No outline found on ${failed.join(', ')}. Adjust the threshold and detect again.`
          : null,
      });
      persist(get());
    } catch (cause) {
      set({ busy: false, progress: null, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  addDraftPoint(point) {
    set({ draft: [...get().draft, point] });
  },

  commitDraft() {
    const { draft, spec, activeLevelId } = get();
    if (draft.length < 3 || !activeLevelId) {
      set({ draft: [] });
      return;
    }
    const level = spec.levels.find((entry) => entry.id === activeLevelId);
    if (!level) {
      set({ draft: [] });
      return;
    }
    const zone: PlanZone = {
      id: newZoneId(),
      name: `Zone_${level.zones.length + 1}`,
      points: draft,
      windowToWallRatio: null,
      hue: hueFor(level.zones.length),
    };
    set({
      history: [...get().history, spec.levels].slice(-UNDO_LIMIT),
      draft: [],
      selectedZoneId: zone.id,
    });
    patchActiveLevel((entry) => ({ ...entry, zones: [...entry.zones, zone] }));
    persist(get());
  },

  cancelDraft() {
    set({ draft: [] });
  },

  updateZone(id, patch) {
    patchActiveLevel((level) => ({
      ...level,
      zones: level.zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)),
    }));
    persist(get());
  },

  moveVertex(id, index, point) {
    patchActiveLevel((level) => ({
      ...level,
      zones: level.zones.map((zone) => {
        if (zone.id !== id || index < 0 || index >= zone.points.length) return zone;
        const points = zone.points.slice();
        points[index] = point;
        return { ...zone, points };
      }),
    }));
  },

  insertVertex(id, index, point) {
    get().pushHistory();
    patchActiveLevel((level) => ({
      ...level,
      zones: level.zones.map((zone) => {
        if (zone.id !== id) return zone;
        const points = zone.points.slice();
        points.splice(index + 1, 0, point);
        return { ...zone, points };
      }),
    }));
    persist(get());
  },

  deleteVertex(id, index) {
    const level = activeLevel(get());
    const target = level?.zones.find((zone) => zone.id === id);
    if (!target || target.points.length <= 3) return;
    get().pushHistory();
    patchActiveLevel((entry) => ({
      ...entry,
      zones: entry.zones.map((zone) => (zone.id === id
        ? { ...zone, points: zone.points.filter((_, i) => i !== index) } : zone)),
    }));
    persist(get());
  },

  translateZone(id, dx, dy) {
    patchActiveLevel((level) => ({
      ...level,
      zones: level.zones.map((zone) => (zone.id === id
        ? { ...zone, points: zone.points.map(([x, y]) => [x + dx, y + dy] as Point2) }
        : zone)),
    }));
  },

  removeZone(id) {
    get().pushHistory();
    patchActiveLevel((level) => ({ ...level, zones: level.zones.filter((zone) => zone.id !== id) }));
    if (get().selectedZoneId === id) set({ selectedZoneId: null });
    persist(get());
  },

  duplicateZone(id) {
    const level = activeLevel(get());
    const source = level?.zones.find((zone) => zone.id === id);
    if (!level || !source) return;

    // Offset the copy so it is visible and not stacked exactly on the original.
    const offset = Math.max(6, Math.hypot(source.points[0][0], source.points[0][1]) * 0.02);
    const copy: PlanZone = {
      ...source,
      id: newZoneId(),
      name: `${source.name}_copy`,
      points: source.points.map(([x, y]) => [x + offset, y + offset] as Point2),
      hue: hueFor(level.zones.length),
    };
    get().pushHistory();
    patchActiveLevel((entry) => ({ ...entry, zones: [...entry.zones, copy] }));
    set({ selectedZoneId: copy.id });
    persist(get());
  },

  simplifySelected() {
    const level = activeLevel(get());
    const zone = level?.zones.find((entry) => entry.id === get().selectedZoneId);
    if (!level || !zone) return;
    const reference = level.image
      ? Math.max(level.image.width, level.image.height) : 1000;
    const points = simplifyRing(zone.points, Math.max(1, 0.008 * reference));
    if (points.length < 3) return;
    get().pushHistory();
    get().updateZone(zone.id, { points });
  },

  squareUpSelected() {
    const level = activeLevel(get());
    const zone = level?.zones.find((entry) => entry.id === get().selectedZoneId);
    if (!zone) return;
    const points = orthogonalize(zone.points);
    if (points.length < 3) return;
    get().pushHistory();
    get().updateZone(zone.id, { points });
  },

  copyZonesFromBelow() {
    const { spec, activeLevelId } = get();
    const index = spec.levels.findIndex((level) => level.id === activeLevelId);
    if (index <= 0) return;
    const below = spec.levels[index - 1];
    if (below.zones.length === 0) return;

    get().pushHistory();
    // Outlines are in each level's own pixel space, so copying is only exact
    // when the two drawings share a resolution; the scales come across too.
    patchActiveLevel((level) => ({
      ...level,
      zones: below.zones.map((zone) => ({ ...zone, id: newZoneId() })),
      metresPerPixelX: below.metresPerPixelX,
      metresPerPixelY: below.metresPerPixelY,
      offsetX: below.offsetX,
      offsetY: below.offsetY,
    }));
    persist(get());
  },

  clearZones() {
    get().pushHistory();
    patchActiveLevel((level) => ({ ...level, zones: [] }));
    set({ selectedZoneId: null, draft: [] });
    persist(get());
  },

  pushHistory() {
    set({ history: [...get().history, get().spec.levels].slice(-UNDO_LIMIT) });
  },

  commitEdit() {
    persist(get());
  },

  undo() {
    const { history, spec } = get();
    if (history.length === 0) return;
    const levels = history[history.length - 1];
    set({
      spec: { ...spec, levels },
      history: history.slice(0, -1),
      activeLevelId: levels.some((level) => level.id === get().activeLevelId)
        ? get().activeLevelId : levels[0]?.id ?? null,
      selectedZoneId: null,
    });
    persist(get());
  },

  updateSpec(patch) {
    set({ spec: { ...get().spec, ...patch } });
    persist(get());
  },

  setProgram(program) {
    const preset = findProgram(program);
    // The preset carries defaults, so the fields it owns follow it unless the
    // user has since overridden them on a level or a zone.
    set({
      spec: {
        ...get().spec,
        program,
        storeyHeight: preset.storeyHeight,
        windowToWallRatio: preset.windowToWallRatio,
      },
    });
    persist(get());
  },

  setExtents(width, depth) {
    set({ spec: scaleToExtents(get().spec, width, depth) });
    persist(get());
  },

  setZoneExtents(id, width, depth) {
    const { activeLevelId } = get();
    if (!activeLevelId) return;
    get().pushHistory();
    set({ spec: resizeZone(get().spec, activeLevelId, id, width, depth) });
    persist(get());
  },

  applyCalibration(calibration) {
    const { activeLevelId } = get();
    if (!activeLevelId) return;

    const pixels = Math.hypot(
      calibration.end[0] - calibration.start[0],
      calibration.end[1] - calibration.start[1],
    );
    if (pixels < 1 || calibration.lengthMetres <= 0) {
      get().updateLevel(activeLevelId, { calibration });
      set({ error: 'The calibration line is too short to measure. Draw it along a longer known dimension.' });
      return;
    }
    set({
      error: null,
      spec: applyLevelScale(get().spec, activeLevelId, calibration.lengthMetres / pixels),
    });
    get().updateLevel(activeLevelId, { calibration });
  },

  setCalibrationLength(lengthMetres) {
    const level = activeLevel(get());
    if (!level?.calibration) return;
    get().applyCalibration({ ...level.calibration, lengthMetres });
  },
}));

// ------------------------------------------------------------------- helpers

/** The level every editing action applies to. */
export function activeLevel(state: { spec: PlanSpec; activeLevelId: string | null }): PlanLevel | null {
  return state.spec.levels.find((level) => level.id === state.activeLevelId) ?? null;
}

export function activeLevelIndex(state: { spec: PlanSpec; activeLevelId: string | null }): number {
  return state.spec.levels.findIndex((level) => level.id === state.activeLevelId);
}

/** Rewrites the active level in place. Zone editing all funnels through here. */
function patchActiveLevel(update: (level: PlanLevel) => PlanLevel): void {
  const { spec, activeLevelId } = usePlanStore.getState();
  if (!activeLevelId) return;
  usePlanStore.setState({
    spec: {
      ...spec,
      levels: spec.levels.map((level) => (level.id === activeLevelId ? update(level) : level)),
    },
  });
}

/** Replaces one level's outlines with freshly detected shapes. */
function applyShapes(levelId: string, shapes: Point2[][]): void {
  const { spec } = usePlanStore.getState();
  const zones: PlanZone[] = shapes.map((points, index) => ({
    id: newZoneId(),
    name: shapes.length === 1 ? 'Zone' : `Zone_${index + 1}`,
    points,
    windowToWallRatio: null,
    hue: hueFor(index),
  }));
  usePlanStore.setState({
    spec: {
      ...spec,
      levels: spec.levels.map((level) => (level.id === levelId ? { ...level, zones } : level)),
    },
  });
}
