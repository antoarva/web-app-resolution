/**
 * Offline project storage.
 *
 * Everything lives in IndexedDB in the browser: there is no server to sync to,
 * so the database is the only copy of a user's work. Projects hold IDF source
 * text; results are cached separately because they are large and always
 * reproducible by re-running the engine.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

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
}

const DB_NAME = 'envelop';
const DB_VERSION = 1;
const PREFERENCES_KEY = 'singleton';

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
      upgrade(db) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('by-updated', 'updatedAt');
        db.createObjectStore('preferences');
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
