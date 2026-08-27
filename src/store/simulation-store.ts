/**
 * Simulation state.
 *
 * The engine runs synchronously inside one WebAssembly call, so the store's job
 * is to keep the UI responsive around it: load the module lazily, yield to the
 * browser before the solve so a progress state can paint, and keep a bounded
 * console of what happened.
 */

import { create } from 'zustand';
import { loadEngine, writeInput, readOutput, formatEngineVersion } from '@/wasm/engine';
import {
  encodeSimulationRequest, decodeSimulationResult,
  type SimulationResult, type SimulationInput,
} from '@/wasm/protocol';
import { buildSimulationInput, simulationBlockers, type SimulationOptions } from '@/core/model/simulation-input';
import type { IdfModel } from '@/core/idf/types';
import type { BuildingModel } from '@/core/model/building';
import type { ClimateLocation } from '@/core/model/climate';

export type SimulationStatus = 'idle' | 'loading-engine' | 'ready' | 'running' | 'complete' | 'error';

export interface ConsoleLine {
  time: number;
  level: 'info' | 'warning' | 'error' | 'success';
  text: string;
}

const MAX_CONSOLE_LINES = 500;

interface SimulationState {
  status: SimulationStatus;
  engineLoaded: boolean;
  engineVersion: string;
  progress: number;
  error: string | null;
  result: SimulationResult | null;
  /** Zone names in the same order as `result.zoneSeries`. */
  zoneNames: string[];
  location: ClimateLocation | null;
  lastInput: SimulationInput | null;
  runTimeMs: number;
  console: ConsoleLine[];
  options: SimulationOptions;

  loadEngineModule(): Promise<void>;
  run(model: IdfModel, building: BuildingModel, options?: SimulationOptions): Promise<void>;
  setOptions(options: Partial<SimulationOptions>): void;
  log(level: ConsoleLine['level'], text: string): void;
  clearConsole(): void;
  reset(): void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  status: 'idle',
  engineLoaded: false,
  engineVersion: '—',
  progress: 0,
  error: null,
  result: null,
  zoneNames: [],
  location: null,
  lastInput: null,
  runTimeMs: 0,
  console: [],
  options: { numDays: 365, timestepsPerHour: 4, startDay: 1 },

  log(level, text) {
    const line: ConsoleLine = { time: Date.now(), level, text };
    const next = [...get().console, line];
    // Bound the buffer so a long session cannot grow without limit.
    set({ console: next.length > MAX_CONSOLE_LINES ? next.slice(-MAX_CONSOLE_LINES) : next });
  },

  clearConsole() {
    set({ console: [] });
  },

  async loadEngineModule() {
    if (get().engineLoaded || get().status === 'loading-engine') return;

    set({ status: 'loading-engine', error: null });
    get().log('info', 'Loading simulation engine…');
    try {
      const engine = await loadEngine();
      const version = formatEngineVersion(engine.engineVersion());
      set({ engineLoaded: true, engineVersion: version, status: 'ready' });
      get().log('success', `Engine ${version} ready (WebAssembly).`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      set({ status: 'error', error: message });
      get().log('error', `Engine failed to load: ${message}`);
    }
  },

  setOptions(options) {
    set({ options: { ...get().options, ...options } });
  },

  async run(model, building, overrides) {
    const blockers = simulationBlockers(building);
    if (blockers.length > 0) {
      set({ status: 'error', error: blockers[0] });
      for (const blocker of blockers) get().log('error', blocker);
      return;
    }

    if (!get().engineLoaded) await get().loadEngineModule();
    if (!get().engineLoaded) return;

    const options: SimulationOptions = { ...get().options, ...overrides };
    set({ status: 'running', progress: 0, error: null, result: null });

    const { input, location, zoneNames } = buildSimulationInput(model, building, options);
    set({ location, zoneNames, lastInput: input });

    get().log('info',
      `Starting run: ${input.zones.length} zone(s), ${input.surfaces.length} surfaces, ` +
      `${input.numDays} days at ${input.timestepsPerHour} timesteps/hour.`);
    get().log('info', `Site: ${location.city}, ${location.country} (ASHRAE ${location.zone}).`);

    // Let the browser paint the running state before the solve blocks the thread.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const started = performance.now();
    try {
      const engine = await loadEngine();
      writeInput(engine, encodeSimulationRequest(input));
      engine.runSimulation();
      const result = decodeSimulationResult(readOutput(engine));
      const runTimeMs = performance.now() - started;

      set({ status: 'complete', result, progress: 1, runTimeMs });
      get().log('success', `Completed ${result.hours} hours in ${runTimeMs.toFixed(0)} ms.`);

      // Surface anything the results say about how well the model held setpoint.
      let unmetHeating = 0;
      let unmetCooling = 0;
      for (const summary of result.zoneSummaries) {
        unmetHeating += summary.unmetHeatingHours;
        unmetCooling += summary.unmetCoolingHours;
      }
      if (unmetHeating > 1 || unmetCooling > 1) {
        get().log('warning',
          `Capacity limits left ${unmetHeating.toFixed(0)} heating and ` +
          `${unmetCooling.toFixed(0)} cooling hours unmet.`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      set({ status: 'error', error: message, progress: 0 });
      get().log('error', `Run failed: ${message}`);
    }
  },

  reset() {
    set({
      status: get().engineLoaded ? 'ready' : 'idle',
      progress: 0, error: null, result: null, runTimeMs: 0,
    });
  },
}));

/** Annual totals across every zone, for the headline figures. */
export function annualTotals(result: SimulationResult | null): {
  heating: number; cooling: number; lighting: number; equipment: number; total: number;
} {
  const totals = { heating: 0, cooling: 0, lighting: 0, equipment: 0, total: 0 };
  if (!result) return totals;

  for (const summary of result.zoneSummaries) {
    totals.heating += summary.heatingKWh;
    totals.cooling += summary.coolingKWh;
    totals.lighting += summary.lightingKWh;
    totals.equipment += summary.equipmentKWh;
  }
  totals.total = totals.heating + totals.cooling + totals.lighting + totals.equipment;
  return totals;
}
