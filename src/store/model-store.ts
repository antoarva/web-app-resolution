/**
 * Model state.
 *
 * The IDF source text is the single source of truth. The object list and the
 * derived building model are both projections of it, rebuilt whenever the text
 * changes. Object-level edits write back through the serialiser, so the text
 * view and the form views can never drift apart.
 */

import { create } from 'zustand';
import {
  type IdfModel, type IdfObject, type ParseIssue,
  emptyModel, createObject, setField, objectName,
} from '@/core/idf/types';
import { parseIdfText, registerCanonicalClasses } from '@/core/idf/parse';
import { serializeModel, serializeObject } from '@/core/idf/serialize';
import { buildModel, type BuildingModel } from '@/core/model/building';
import { allClassNames } from '@/core/idd/schema';
import { findTemplate, DEFAULT_TEMPLATE_ID } from '@/core/templates/buildings';
import { DEFAULT_LOCATION_ID } from '@/core/model/climate';
import { newProjectId, saveProject, type StoredProject } from '@/lib/persistence';

registerCanonicalClasses(allClassNames());

export interface Selection {
  objectId: string | null;
  zoneName: string | null;
  surfaceId: string | null;
}

interface ModelState {
  projectId: string;
  projectName: string;
  locationId: string;
  source: string;
  model: IdfModel;
  building: BuildingModel | null;
  issues: ParseIssue[];
  selection: Selection;
  /** True while a parse or geometry pass is in flight. */
  busy: boolean;
  /** Set when the last parse failed outright, e.g. the engine could not load. */
  error: string | null;
  parseTimeMs: number;
  dirty: boolean;
  lastSavedAt: number | null;

  setSource(source: string, options?: { reparse?: boolean }): Promise<void>;
  loadTemplate(templateId: string, locationId?: string): Promise<void>;
  loadProject(project: StoredProject): Promise<void>;
  refresh(): Promise<void>;

  select(selection: Partial<Selection>): void;
  clearSelection(): void;

  updateObjectField(objectId: string, fieldIndex: number, value: string): Promise<void>;
  addObject(className: string, fields?: string[]): Promise<string | null>;
  duplicateObject(objectId: string): Promise<string | null>;
  deleteObject(objectId: string): Promise<void>;
  replaceObjectText(objectId: string, text: string): Promise<void>;

  setProjectName(name: string): void;
  setLocationId(locationId: string): void;
  save(): Promise<void>;
}

/** Parses `source` and rebuilds every projection derived from it. */
async function project(source: string): Promise<{
  model: IdfModel; building: BuildingModel | null; issues: ParseIssue[]; parseTimeMs: number; error: string | null;
}> {
  try {
    const { model, issues, parseTimeMs } = await parseIdfText(source);
    const building = await buildModel(model);
    return { model, building, issues, parseTimeMs, error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { model: emptyModel(), building: null, issues: [], parseTimeMs: 0, error: message };
  }
}

export const useModelStore = create<ModelState>((set, get) => ({
  projectId: newProjectId(),
  projectName: 'Untitled Project',
  locationId: DEFAULT_LOCATION_ID,
  source: '',
  model: emptyModel(),
  building: null,
  issues: [],
  selection: { objectId: null, zoneName: null, surfaceId: null },
  busy: false,
  error: null,
  parseTimeMs: 0,
  dirty: false,
  lastSavedAt: null,

  async setSource(source, options) {
    set({ source, dirty: true });
    if (options?.reparse === false) return;

    set({ busy: true });
    const result = await project(source);
    set({ ...result, busy: false });
  },

  async loadTemplate(templateId, locationId) {
    const template = findTemplate(templateId) ?? findTemplate(DEFAULT_TEMPLATE_ID);
    if (!template) return;

    const resolvedLocation = locationId ?? get().locationId;
    const source = template.build(resolvedLocation);

    set({ busy: true, projectId: newProjectId(), projectName: template.name, locationId: resolvedLocation,
      selection: { objectId: null, zoneName: null, surfaceId: null } });

    const result = await project(source);
    set({ source, ...result, busy: false, dirty: true });
  },

  async loadProject(stored) {
    set({
      busy: true,
      projectId: stored.id,
      projectName: stored.name,
      locationId: stored.locationId,
      selection: { objectId: null, zoneName: null, surfaceId: null },
    });
    const result = await project(stored.source);
    set({ source: stored.source, ...result, busy: false, dirty: false, lastSavedAt: stored.updatedAt });
  },

  async refresh() {
    set({ busy: true });
    const result = await project(get().source);
    set({ ...result, busy: false });
  },

  select(selection) {
    set({ selection: { ...get().selection, ...selection } });
  },

  clearSelection() {
    set({ selection: { objectId: null, zoneName: null, surfaceId: null } });
  },

  async updateObjectField(objectId, fieldIndex, value) {
    const { model } = get();
    const index = model.objects.findIndex((object) => object.id === objectId);
    if (index === -1) return;

    const objects = model.objects.slice();
    objects[index] = setField(objects[index], fieldIndex, value);
    await get().setSource(serializeModel({ objects }));
  },

  async addObject(className, fields = []) {
    const { model } = get();
    const created = createObject(className, fields);
    const objects = [...model.objects, created];
    await get().setSource(serializeModel({ objects }));

    // Ids are reassigned by the re-parse, so match the new object by position.
    const reparsed = get().model.objects;
    const match = reparsed[reparsed.length - 1];
    if (match) {
      get().select({ objectId: match.id });
      return match.id;
    }
    return null;
  },

  async duplicateObject(objectId) {
    const { model } = get();
    const index = model.objects.findIndex((object) => object.id === objectId);
    if (index === -1) return null;

    const original = model.objects[index];
    const copy = createObject(original.className, original.fields.slice());
    // Names must stay unique, so suffix the copy.
    if (copy.fields.length > 0 && copy.fields[0].trim() !== '') {
      copy.fields[0] = uniqueName(model, original.className, copy.fields[0]);
    }

    const objects = model.objects.slice();
    objects.splice(index + 1, 0, copy);
    await get().setSource(serializeModel({ objects }));

    const reparsed = get().model.objects[index + 1];
    if (reparsed) {
      get().select({ objectId: reparsed.id });
      return reparsed.id;
    }
    return null;
  },

  async deleteObject(objectId) {
    const { model, selection } = get();
    const objects = model.objects.filter((object) => object.id !== objectId);
    if (objects.length === model.objects.length) return;

    if (selection.objectId === objectId) get().clearSelection();
    await get().setSource(serializeModel({ objects }));
  },

  async replaceObjectText(objectId, text) {
    const { model } = get();
    const index = model.objects.findIndex((object) => object.id === objectId);
    if (index === -1) return;

    // Re-serialise the whole file with this one object's text swapped in.
    const blocks = model.objects.map((object, position) =>
      position === index ? text.trim() : serializeObject(object));
    await get().setSource(`${blocks.join('\n\n')}\n`);
  },

  setProjectName(name) {
    set({ projectName: name, dirty: true });
  },

  setLocationId(locationId) {
    set({ locationId, dirty: true });
  },

  async save() {
    const { projectId, projectName, locationId, source } = get();
    await saveProject({
      id: projectId,
      name: projectName,
      source,
      locationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      size: source.length,
    });
    set({ dirty: false, lastSavedAt: Date.now() });
  },
}));

/** Appends a numeric suffix until the name is free within its class. */
function uniqueName(model: IdfModel, className: string, base: string): string {
  const taken = new Set(
    model.objects
      .filter((object) => object.className.toLowerCase() === className.toLowerCase())
      .map((object) => objectName(object).trim().toLowerCase()),
  );

  const stem = base.replace(/\s+\d+$/, '').trim();
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${stem} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} copy`;
}

/** Convenience selector: the currently selected IDF object. */
export function selectedObject(state: ModelState): IdfObject | null {
  const id = state.selection.objectId;
  if (!id) return null;
  return state.model.objects.find((object) => object.id === id) ?? null;
}
