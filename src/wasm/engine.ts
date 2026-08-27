/**
 * WebAssembly engine host.
 *
 * The engine owns all compute in this app: IDF parsing, surface geometry and
 * the annual heat balance. Everything here is glue — allocate a request in
 * linear memory, call an export, read the response back out.
 *
 * Memory can grow during a call, which detaches any previously created view, so
 * every accessor re-reads `memory.buffer` instead of caching a view.
 */

export interface EngineExports {
  memory: WebAssembly.Memory;
  engineVersion(): number;
  allocInput(size: number): number;
  inputPtr(): number;
  inputSize(): number;
  outputPtr(): number;
  outputLen(): number;
  parseIdf(): number;
  computeGeometry(): number;
  runSimulation(): number;
  simulationProgress(): number;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

const WASM_URL = new URL('/engine/envelop.wasm', import.meta.url).href;

let instancePromise: Promise<EngineExports> | null = null;

function makeImports(): WebAssembly.Imports {
  return {
    env: {
      // AssemblyScript calls this instead of throwing; the message pointers are
      // only resolvable with the runtime exported, so report the location.
      abort(_message: number, _fileName: number, line: number, column: number) {
        throw new EngineError(`engine aborted at ${line}:${column}`);
      },
      trace(_message: number, _arity: number) {
        /* engine tracing is disabled in release builds */
      },
      seed() {
        return Date.now();
      },
    },
  };
}

/** Loads and instantiates the engine once, reusing it for the session. */
export function loadEngine(): Promise<EngineExports> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const response = await fetch(WASM_URL);
      if (!response.ok) {
        throw new EngineError(`could not fetch engine (${response.status})`);
      }
      const imports = makeImports();
      // instantiateStreaming needs the right MIME type; fall back when a
      // service worker or dev server serves the file as octet-stream.
      let result: WebAssembly.WebAssemblyInstantiatedSource;
      if (response.headers.get('content-type')?.includes('application/wasm')) {
        result = await WebAssembly.instantiateStreaming(response, imports);
      } else {
        result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
      }
      return result.instance.exports as unknown as EngineExports;
    })().catch((error) => {
      instancePromise = null; // let a later attempt retry
      throw error;
    });
  }
  return instancePromise;
}

/** Copies `data` into the engine's input buffer. */
export function writeInput(engine: EngineExports, data: Uint8Array): void {
  const pointer = engine.allocInput(data.length);
  new Uint8Array(engine.memory.buffer, pointer, data.length).set(data);
}

/** Returns a copy of the engine's output buffer, safe to keep after later calls. */
export function readOutput(engine: EngineExports): Uint8Array {
  const pointer = engine.outputPtr();
  const length = engine.outputLen();
  return new Uint8Array(engine.memory.buffer.slice(pointer, pointer + length));
}

/** Zero-copy view of the output buffer, only valid until the next engine call. */
export function viewOutput(engine: EngineExports): DataView {
  return new DataView(engine.memory.buffer, engine.outputPtr(), engine.outputLen());
}

export function formatEngineVersion(raw: number): string {
  const major = Math.floor(raw / 10000);
  const minor = Math.floor((raw % 10000) / 100);
  const patch = raw % 100;
  return `${major}.${minor}.${patch}`;
}
