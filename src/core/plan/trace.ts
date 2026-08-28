/**
 * Turns a bitmap floor plan into footprint polygons.
 *
 * The pipeline is deliberately classical rather than clever: threshold to a
 * binary mask, label 4-connected components, follow the boundary of each with
 * marching squares, then simplify and square up the result. That is enough to
 * lift a usable reference footprint out of a scanned plan, a screenshot of a
 * mapping site, or a hand sketch, and every stage is inspectable when it goes
 * wrong.
 *
 * Analysis runs on a downscaled copy of the image; the polygons that come back
 * are mapped up to original-image pixel coordinates so the on-screen overlay
 * and the user's own tracing share one space.
 */

import type { Point2 } from '@/core/templates/geometry';
import { simplifyRing, orthogonalize, polygonArea, bounds, dedupe } from './polygon';

/** The largest analysis raster we will work on, in pixels along the long side. */
const MAX_ANALYSIS_SIZE = 900;

export interface AnalysisImage {
  /** Greyscale luminance, 0-255, row major. */
  luminance: Uint8Array;
  width: number;
  height: number;
  /** Multiply analysis coordinates by this to get original image pixels. */
  scale: number;
  sourceWidth: number;
  sourceHeight: number;
}

export type TraceStrategy = 'outline' | 'rectangle' | 'rooms';

export interface TraceOptions {
  strategy: TraceStrategy;
  /** Luminance cut, 0-1. Pixels darker than this count as ink. */
  threshold: number;
  /** Treat light pixels as the building instead — for dark-background plans. */
  invert: boolean;
  /** Corner tolerance as a fraction of the image's long side. */
  detail: number;
  /** Force near-axis edges parallel to the plan's dominant direction. */
  squareUp: boolean;
  /** Ignore blobs smaller than this fraction of the image. */
  minAreaFraction: number;
  maxShapes: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  strategy: 'outline',
  threshold: 0.55,
  invert: false,
  detail: 0.012,
  squareUp: true,
  minAreaFraction: 0.004,
  maxShapes: 12,
};

/** Decodes `src` and returns a downscaled luminance raster to analyse. */
export async function loadAnalysisImage(src: string): Promise<AnalysisImage> {
  const image = await decode(src);
  const longest = Math.max(image.width, image.height);
  const factor = longest > MAX_ANALYSIS_SIZE ? MAX_ANALYSIS_SIZE / longest : 1;
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not read the image: 2D canvas is unavailable.');
  // A white bed keeps transparent PNGs from reading as solid ink.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const luminance = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < luminance.length; i++, p += 4) {
    luminance[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }

  return {
    luminance, width, height,
    scale: image.width / width,
    sourceWidth: image.width,
    sourceHeight: image.height,
  };
}

export function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file could not be decoded as an image.'));
    image.src = src;
  });
}

interface Component {
  label: number;
  area: number;
  minX: number;
  minY: number;
  /** First pixel in scan order, the seed for boundary following. */
  startX: number;
  startY: number;
  touchesBorder: boolean;
}

interface LabelledMask {
  labels: Int32Array;
  components: Component[];
  width: number;
  height: number;
}

/** 4-connected labelling of every `true` pixel in `mask`. */
function label(mask: Uint8Array, width: number, height: number): LabelledMask {
  const labels = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  const stack = new Int32Array(width * height);

  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || labels[seed] !== -1) continue;

    const current = components.length;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = current;

    const component: Component = {
      label: current,
      area: 0,
      minX: width,
      minY: height,
      startX: seed % width,
      startY: Math.floor(seed / width),
      touchesBorder: false,
    };

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      component.area++;
      if (x < component.minX) component.minX = x;
      if (y < component.minY) component.minY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) component.touchesBorder = true;

      if (x > 0 && mask[index - 1] !== 0 && labels[index - 1] === -1) {
        labels[index - 1] = current;
        stack[top++] = index - 1;
      }
      if (x < width - 1 && mask[index + 1] !== 0 && labels[index + 1] === -1) {
        labels[index + 1] = current;
        stack[top++] = index + 1;
      }
      if (y > 0 && mask[index - width] !== 0 && labels[index - width] === -1) {
        labels[index - width] = current;
        stack[top++] = index - width;
      }
      if (y < height - 1 && mask[index + width] !== 0 && labels[index + width] === -1) {
        labels[index + width] = current;
        stack[top++] = index + width;
      }
    }

    components.push(component);
  }

  return { labels, components, width, height };
}

const enum Direction { Up, Down, Left, Right }

/**
 * Marching-squares boundary walk around one labelled component.
 *
 * The walk happens on the grid of pixel *corners*, so the contour returned runs
 * along pixel edges and is exact rather than a chain of pixel centres. At each
 * corner the four surrounding pixels give a case number that names the step.
 *
 * The case table falls out of two requirements. A step must cross a boundary,
 * so the two pixels flanking the crack it traverses must differ; and the walk
 * keeps the component on its right, which fixes which of the two is filled.
 * With the quadrants named tl/tr/bl/br and screen Y pointing down:
 *
 *     Right  needs br filled, tr empty      Left  needs tl filled, bl empty
 *     Down   needs bl filled, br empty      Up    needs tr filled, tl empty
 *
 * Exactly one direction satisfies that at every case except the two diagonals,
 * where both candidates are legal and the walk keeps hugging whichever pixel it
 * was already following.
 */
function traceComponent(mask: LabelledMask, component: Component): Point2[] {
  const { labels, width, height } = mask;
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === component.label;

  const contour: Point2[] = [];
  const startX = component.startX;
  const startY = component.startY;
  let x = startX;
  let y = startY;
  let direction = Direction.Right;

  // A closed crack contour cannot be longer than the number of grid edges.
  const limit = (width + 1) * (height + 1) * 4;
  for (let step = 0; step < limit; step++) {
    contour.push([x, y]);

    const state = (filled(x - 1, y - 1) ? 1 : 0)
      + (filled(x, y - 1) ? 2 : 0)
      + (filled(x - 1, y) ? 4 : 0)
      + (filled(x, y) ? 8 : 0);

    switch (state) {
      case 1: case 3: case 11: direction = Direction.Left; break;
      case 2: case 10: case 14: direction = Direction.Up; break;
      case 4: case 5: case 7: direction = Direction.Down; break;
      case 8: case 12: case 13: direction = Direction.Right; break;
      case 6:
        direction = direction === Direction.Right || direction === Direction.Down
          ? Direction.Down : Direction.Up;
        break;
      case 9:
        direction = direction === Direction.Up || direction === Direction.Right
          ? Direction.Right : Direction.Left;
        break;
      default:
        // 0 and 15 cannot occur on a boundary corner; bail rather than spin.
        return contour;
    }

    if (direction === Direction.Up) y -= 1;
    else if (direction === Direction.Down) y += 1;
    else if (direction === Direction.Left) x -= 1;
    else x += 1;

    if (x === startX && y === startY) break;
  }

  return contour;
}

function buildMask(image: AnalysisImage, threshold: number, invert: boolean): Uint8Array {
  const cut = Math.round(Math.max(0, Math.min(1, threshold)) * 255);
  const mask = new Uint8Array(image.luminance.length);
  for (let i = 0; i < mask.length; i++) {
    const dark = image.luminance[i] < cut;
    mask[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return mask;
}

/**
 * Fills the holes inside each blob so a plan drawn as outlines-only traces as
 * one solid footprint rather than a thin ribbon following both wall faces.
 */
function fillEnclosed(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let top = 0;

  const push = (index: number): void => {
    if (mask[index] === 0 && outside[index] === 0) {
      outside[index] = 1;
      stack[top++] = index;
    }
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  const filledMask = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) filledMask[i] = mask[i] !== 0 || outside[i] === 0 ? 1 : 0;
  return filledMask;
}

/**
 * Extracts candidate footprints, in original-image pixel coordinates, largest
 * first. `outline` returns the building envelope, `rectangle` its bounding box,
 * and `rooms` the enclosed spaces between the drawn walls.
 */
export function traceImage(image: AnalysisImage, options: TraceOptions): Point2[][] {
  const { width, height, scale } = image;
  const total = width * height;
  const minArea = Math.max(24, options.minAreaFraction * total);

  const ink = buildMask(image, options.threshold, options.invert);
  let mask: Uint8Array;
  let keepBorderTouching = true;

  if (options.strategy === 'rooms') {
    // Rooms are the voids between walls: everything that is not ink, minus the
    // region connected to the image border, which is the sheet around the plan.
    mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) mask[i] = ink[i] === 0 ? 1 : 0;
    keepBorderTouching = false;
  } else {
    mask = fillEnclosed(ink, width, height);
  }

  const labelled = label(mask, width, height);
  const candidates = labelled.components
    .filter((component) => component.area >= minArea)
    .filter((component) => keepBorderTouching || !component.touchesBorder)
    .sort((a, b) => b.area - a.area)
    .slice(0, options.strategy === 'outline' || options.strategy === 'rectangle'
      ? 1 : options.maxShapes);

  const tolerance = Math.max(1, options.detail * Math.max(width, height));
  const shapes: Point2[][] = [];

  for (const component of candidates) {
    const contour = traceComponent(labelled, component);
    if (contour.length < 4) continue;

    let ring = simplifyRing(contour, tolerance);
    if (options.squareUp) ring = orthogonalize(ring);
    ring = dedupe(ring, 0.5);
    if (ring.length < 3 || polygonArea(ring) < minArea * 0.5) continue;

    if (options.strategy === 'rectangle') {
      const box = bounds(ring);
      ring = [
        [box.minX, box.minY], [box.maxX, box.minY],
        [box.maxX, box.maxY], [box.minX, box.maxY],
      ];
    }

    shapes.push(ring.map(([x, y]) => [x * scale, y * scale] as Point2));
  }

  return shapes;
}
