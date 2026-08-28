/**
 * Offline project storage.
 *
 * Everything lives in IndexedDB in the browser: there is no server to sync to,
 * so the database is the only copy of a user's work. Projects hold IDF source
 * text; results are cached separately because they are large and always
 * reproducible by re-running the engine.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PlanSpec, PlanZone, Calibration, ImageSource } from '@/core/plan/types';

export interface StoredProject {
  id: string;
  name: string;
  source: string;
  templateId?: string;
  locationId: string;
  createdAt: number;
  updatedAt: number;
  /** Byte length of `source`, kept so the project list avoids re-measuring. */
  size: number;
}

/**
 * The last plan traced from images, kept whole so its dimensions stay editable
 * after a reload. Only one is held: the importer is a workbench for the current
 * model, not a library.
 */
export interface StoredPlan {
  spec: PlanSpec;
  updatedAt: number;
}

/** The single-image record written before plans became a stack of levels. */
interface LegacyStoredPlan {
  image: ImageSource;
  calibration: Calibration | null;
  updatedAt: number;
  spec: {
    name: string;
    locationId: string;
    program: PlanSpec['program'];
    storeys: number;
    storeyHeight: number;
    northAxis: number;
    windowToWallRatio: number;
    metresPerPixelX: number;
    metresPerPixelY: number;
    lockAspect: boolean;
    zones: (PlanZone & { storeyOverride?: number | null; heightOverride?: number | null })[];
  };
}

function isLegacy(record: StoredPlan | LegacyStoredPlan): record is LegacyStoredPlan {
  return Array.isArray((record as LegacyStoredPlan).spec?.zones);
}

/**
 * Folds a one-image plan into the level stack. The old `storeys` count becomes
 * a single level that repeats, which is exactly what it used to mean.
 */
function migratePlan(record: LegacyStoredPlan): StoredPlan {
  const old = record.spec;
  return {
    updatedAt: record.updatedAt,
    spec: {
      name: old.name,
      locationId: old.locationId,
      program: old.program,
      storeyHeight: old.storeyHeight,
      northAxis: old.northAxis,
      windowToWallRatio: old.windowToWallRatio,
      lockAspect: old.lockAspect,
      levels: [{
        id: 'level_migrated',
        name: 'Level 1',
        image: record.image,
        zones: old.zones.map(({ id, name, points, windowToWallRatio, hue }) => ({
          id, name, points, windowToWallRatio, hue,
        })),
        metresPerPixelX: old.metresPerPixelX,
        metresPerPixelY: old.metresPerPixelY,
        offsetX: 0,
        offsetY: 0,
        heightOverride: null,
        repeat: Math.max(1, Math.round(old.storeys)),
        calibration: record.calibration,
      }],
    },
  };
}

export interface StoredPreferences {
  theme: 'light' | 'dark' | 'system';
  lastProjectId?: string;
  editorFontSize: number;
  showGrid: boolean;
  showEdges: boolean;
  autoRun: boolean;
}

interface EnvelopSchema extends DBSchema {
  projects: {
    key: string;
    value: StoredProject;
    indexes: { 'by-updated': number };
  };
  preferences: {
    key: string;
    value: StoredPreferences;
  };
  plans: {
    key: string;
    value: StoredPlan | LegacyStoredPlan;
  };
}

const DB_NAME = 'envelop';
const DB_VERSION = 2;
const PREFERENCES_KEY = 'singleton';
const PLAN_KEY = 'current';

export const DEFAULT_PREFERENCES: StoredPreferences = {
  theme: 'system',
  editorFontSize: 13,
  showGrid: true,
  showEdges: true,
  autoRun: false,
};

let databasePromise: Promise<IDBPDatabase<EnvelopSchema>> | null = null;

function database(): Promise<IDBPDatabase<EnvelopSchema>> {
  if (!databasePromise) {
    databasePromise = openDB<EnvelopSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Each step runs for anyone arriving from an older schema, so the
        // clauses stay separate rather than assuming an empty database.
        if (oldVersion < 1) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('by-updated', 'updatedAt');
          db.createObjectStore('preferences');
        }
        if (oldVersion < 2) {
          db.createObjectStore('plans');
        }
      },
    });
  }
  return databasePromise;
}

/**
 * Storage can be unavailable in private windows or when the origin is denied
 * quota. The app still works — it just loses persistence — so every call here
 * degrades to a no-op rather than throwing into the UI.
 */
async function withDatabase<T>(action: (db: IDBPDatabase<EnvelopSchema>) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action(await database());
  } catch (error) {
    console.warn('Envelop: persistence unavailable', error);
    return fallback;
  }
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProjects(): Promise<StoredProject[]> {
  return withDatabase(async (db) => {
    const projects = await db.getAllFromIndex('projects', 'by-updated');
    return projects.reverse(); // most recently touched first
  }, []);
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
  return withDatabase((db) => db.get('projects', id), undefined);
}

export async function saveProject(project: StoredProject): Promise<void> {
  await withDatabase(async (db) => {
    await db.put('projects', { ...project, size: project.source.length, updatedAt: Date.now() });
  }, undefined);
}

export async function deleteProject(id: string): Promise<void> {
  await withDatabase((db) => db.delete('projects', id), undefined);
}

export async function loadPreferences(): Promise<StoredPreferences> {
  return withDatabase(async (db) => {
    const stored = await db.get('preferences', PREFERENCES_KEY);
    return { ...DEFAULT_PREFERENCES, ...stored };
  }, DEFAULT_PREFERENCES);
}

export async function savePreferences(preferences: StoredPreferences): Promise<void> {
  await withDatabase((db) => db.put('preferences', preferences, PREFERENCES_KEY).then(() => undefined), undefined);
}

export async function loadPlan(): Promise<StoredPlan | undefined> {
  return withDatabase(async (db) => {
    const record = await db.get('plans', PLAN_KEY);
    if (!record) return undefined;
    return isLegacy(record) ? migratePlan(record) : record;
  }, undefined);
}

export async function savePlan(plan: StoredPlan): Promise<void> {
  await withDatabase(
    (db) => db.put('plans', { ...plan, updatedAt: Date.now() }, PLAN_KEY).then(() => undefined),
    undefined,
  );
}

export async function clearPlan(): Promise<void> {
  await withDatabase((db) => db.delete('plans', PLAN_KEY), undefined);
}

/** Rough usage figure for the storage panel; not all browsers report it. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Asks the browser to keep this origin's data through storage pressure.
 * Chrome grants it silently for installed apps; others may prompt or decline.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
