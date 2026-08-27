/**
 * In-memory representation of an IDF file.
 *
 * Objects keep their fields as raw strings, exactly as EnergyPlus stores them:
 * a field may legitimately hold a number, a name, a keyword, `autosize`, or be
 * blank to mean "use the IDD default". Coercing early would lose that, so the
 * schema layer interprets values on demand instead.
 */

export interface IdfObject {
  /** Stable identity across edits, so UI selection survives re-parsing. */
  id: string;
  className: string;
  /** Fields after the class name; field 0 is usually the object's Name. */
  fields: string[];
}

export interface IdfModel {
  objects: IdfObject[];
}

export interface ParseIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  objectId?: string;
  className?: string;
}

let idCounter = 0;

/** Monotonic ids are enough here: identity only needs to be unique per session. */
export function nextObjectId(): string {
  idCounter += 1;
  return `obj_${idCounter.toString(36)}`;
}

export function createObject(className: string, fields: string[] = []): IdfObject {
  return { id: nextObjectId(), className, fields };
}

export function emptyModel(): IdfModel {
  return { objects: [] };
}

/** Case-insensitive class lookup; EnergyPlus class names are not case sensitive. */
export function objectsOfClass(model: IdfModel, className: string): IdfObject[] {
  const target = className.toLowerCase();
  return model.objects.filter((object) => object.className.toLowerCase() === target);
}

export function objectsOfClasses(model: IdfModel, classNames: string[]): IdfObject[] {
  const targets = new Set(classNames.map((name) => name.toLowerCase()));
  return model.objects.filter((object) => targets.has(object.className.toLowerCase()));
}

export function firstOfClass(model: IdfModel, className: string): IdfObject | undefined {
  const target = className.toLowerCase();
  return model.objects.find((object) => object.className.toLowerCase() === target);
}

/** Field 0 by convention, blank for the handful of classes without a Name. */
export function objectName(object: IdfObject): string {
  return object.fields[0] ?? '';
}

export function findByName(model: IdfModel, className: string, name: string): IdfObject | undefined {
  const target = name.trim().toLowerCase();
  return objectsOfClass(model, className).find(
    (object) => objectName(object).trim().toLowerCase() === target,
  );
}

/** Reads a field as a number, falling back when blank, `autosize`, or invalid. */
export function numericField(object: IdfObject, index: number, fallback = 0): number {
  const raw = object.fields[index];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'autosize' || lowered === 'autocalculate') return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

export function textField(object: IdfObject, index: number, fallback = ''): string {
  const raw = object.fields[index];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

export function isAutosized(object: IdfObject, index: number): boolean {
  const raw = (object.fields[index] ?? '').trim().toLowerCase();
  return raw === 'autosize' || raw === 'autocalculate';
}

/** Grows the field list so an editor can write past the current end. */
export function setField(object: IdfObject, index: number, value: string): IdfObject {
  const fields = object.fields.slice();
  while (fields.length <= index) fields.push('');
  fields[index] = value;
  return { ...object, fields };
}

export function countByClass(model: IdfModel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of model.objects) {
    counts.set(object.className, (counts.get(object.className) ?? 0) + 1);
  }
  return counts;
}
