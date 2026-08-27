/**
 * IDF text -> model, with the tokenizing done in WebAssembly.
 *
 * The engine returns a flat object table; this layer only assigns identities
 * and normalises class-name casing so lookups elsewhere can be exact.
 */

import { loadEngine, writeInput, readOutput } from '@/wasm/engine';
import { decodeIdfObjects } from '@/wasm/protocol';
import { type IdfModel, type IdfObject, type ParseIssue, nextObjectId } from './types';
import { getClassSchema } from '@/core/idd/schema';

export interface ParseResult {
  model: IdfModel;
  issues: ParseIssue[];
  /** Milliseconds spent inside the engine, shown in the status bar. */
  parseTimeMs: number;
}

/**
 * Canonical casing for the classes the app knows about, so `zone` typed by hand
 * still matches `Zone` everywhere. Unknown classes keep whatever the file used.
 */
const CANONICAL_CLASSES = new Map<string, string>();

export function registerCanonicalClasses(names: string[]): void {
  for (const name of names) CANONICAL_CLASSES.set(name.toLowerCase(), name);
}

function canonicalise(className: string): string {
  return CANONICAL_CLASSES.get(className.toLowerCase()) ?? className;
}

export async function parseIdfText(text: string): Promise<ParseResult> {
  const engine = await loadEngine();
  const issues: ParseIssue[] = [];

  const started = performance.now();
  const bytes = new TextEncoder().encode(text);
  writeInput(engine, bytes);
  engine.parseIdf();
  const raw = decodeIdfObjects(readOutput(engine));
  const parseTimeMs = performance.now() - started;

  const objects: IdfObject[] = [];
  for (const entry of raw) {
    // A stray semicolon yields an object with no class name; drop it rather
    // than surfacing a phantom row in the explorer.
    if (!entry.className) {
      if (entry.fields.some((field) => field !== '')) {
        issues.push({ severity: 'warning', message: 'Skipped an object with no class name.' });
      }
      continue;
    }
    objects.push({
      id: nextObjectId(),
      className: canonicalise(entry.className),
      fields: entry.fields,
    });
  }

  const model: IdfModel = { objects };
  issues.push(...validateModel(model));
  return { model, issues, parseTimeMs };
}

/** Structural checks that do not need the full IDD. */
export function validateModel(model: IdfModel): ParseIssue[] {
  const issues: ParseIssue[] = [];

  const versions = model.objects.filter((o) => o.className.toLowerCase() === 'version');
  if (versions.length === 0) {
    issues.push({ severity: 'warning', message: 'No Version object. EnergyPlus assumes the running version.' });
  } else if (versions.length > 1) {
    issues.push({ severity: 'error', message: `${versions.length} Version objects found; only one is allowed.` });
  }

  // Duplicate names within a class break every object-list reference to them.
  //
  // Only classes whose first field is literally "Name" carry a unique
  // identifier there. Plenty of classes do not: Output:Variable's first field
  // is a Key Value that is usually "*", and repeating it is entirely valid.
  const seen = new Map<string, Set<string>>();
  for (const object of model.objects) {
    const schema = getClassSchema(object.className);
    if (schema && schema.fields[0]?.name !== 'Name') continue;

    const name = (object.fields[0] ?? '').trim().toLowerCase();
    if (!name) continue;
    const key = object.className.toLowerCase();
    let names = seen.get(key);
    if (!names) {
      names = new Set();
      seen.set(key, names);
    }
    if (names.has(name)) {
      issues.push({
        severity: 'error',
        message: `Duplicate ${object.className} named "${object.fields[0]}".`,
        objectId: object.id,
        className: object.className,
      });
    }
    names.add(name);
  }

  if (model.objects.length === 0) {
    issues.push({ severity: 'info', message: 'The file contains no objects.' });
  }
  return issues;
}
