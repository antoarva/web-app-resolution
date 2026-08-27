/**
 * Derives an HVAC schematic from the model.
 *
 * The templates in this app use ideal-loads systems, which have no plant to
 * draw. Rather than showing an empty canvas, the graph reconstructs the air
 * path those templates imply — outdoor air, conditioning, distribution, zones
 * and return — and annotates it with what the model actually declares.
 */

import { type IdfModel, objectsOfClass, objectName, textField, numericField } from '@/core/idf/types';
import type { BuildingModel } from '@/core/model/building';

export type NodeKind =
  | 'outdoor-air' | 'mixing' | 'cooling-coil' | 'heating-coil' | 'fan'
  | 'supply' | 'zone' | 'return' | 'exhaust' | 'thermostat';

export interface SchematicNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Key/value detail rows shown inside the node. */
  detail: [string, string][];
  position: { x: number; y: number };
  hasInput: boolean;
  hasOutput: boolean;
}

export interface SchematicConnection {
  from: string;
  to: string;
  label?: string;
}

export interface Schematic {
  nodes: SchematicNode[];
  connections: SchematicConnection[];
  /** Set when the model has no HVAC objects and the graph is illustrative. */
  inferred: boolean;
}

const COLUMN = 250;
const ROW = 150;
/**
 * Vertical pitch for the zone stack.
 *
 * Zone nodes carry four detail rows, so they render taller than the spine
 * nodes. Spacing them at ROW overlaps their bodies; this pitch clears them.
 */
const ZONE_ROW = 215;

export function buildSchematic(model: IdfModel, building: BuildingModel | null): Schematic {
  const nodes: SchematicNode[] = [];
  const connections: SchematicConnection[] = [];

  const idealLoads = objectsOfClass(model, 'HVACTemplate:Zone:IdealLoadsAirSystem');
  const thermostats = objectsOfClass(model, 'HVACTemplate:Thermostat');
  const zones = building?.zones ?? [];
  const inferred = idealLoads.length === 0;

  // --- Air path spine ---
  const spine: { id: string; kind: NodeKind; label: string; detail: [string, string][] }[] = [
    {
      id: 'outdoor-air', kind: 'outdoor-air', label: 'Outdoor Air',
      detail: [
        ['Source', building ? `${building.site.name}` : 'Site'],
        ['Latitude', building ? `${building.site.latitude.toFixed(2)}°` : '—'],
      ],
    },
    {
      id: 'mixing', kind: 'mixing', label: 'Mixing Box',
      detail: [['Type', 'Outdoor + return'], ['Economizer', 'Not modelled']],
    },
    {
      id: 'cooling-coil', kind: 'cooling-coil', label: 'Cooling Coil',
      detail: coolingDetail(idealLoads),
    },
    {
      id: 'heating-coil', kind: 'heating-coil', label: 'Heating Coil',
      detail: heatingDetail(idealLoads),
    },
    {
      id: 'fan', kind: 'fan', label: 'Supply Fan',
      detail: [['Control', 'Variable volume'], ['Modelled', inferred ? 'Implied' : 'Ideal loads']],
    },
    {
      id: 'supply', kind: 'supply', label: 'Supply Plenum',
      detail: [['Serves', `${Math.max(zones.length, idealLoads.length)} zones`]],
    },
  ];

  spine.forEach((entry, index) => {
    nodes.push({
      ...entry,
      position: { x: index * COLUMN, y: 0 },
      hasInput: index > 0,
      hasOutput: true,
    });
    if (index > 0) {
      connections.push({ from: spine[index - 1].id, to: entry.id });
    }
  });

  // --- Thermostat feeding the coils ---
  const thermostat = thermostats[0];
  if (thermostat) {
    nodes.push({
      id: `thermostat-${thermostat.id}`,
      kind: 'thermostat',
      label: objectName(thermostat) || 'Thermostat',
      detail: [
        ['Heating', formatSetpoint(numericField(thermostat, 2, NaN), textField(thermostat, 1, ''))],
        ['Cooling', formatSetpoint(numericField(thermostat, 4, NaN), textField(thermostat, 3, ''))],
      ],
      position: { x: 2 * COLUMN + COLUMN / 2, y: -ROW - 20 },
      hasInput: false,
      hasOutput: true,
    });
    connections.push({ from: `thermostat-${thermostat.id}`, to: 'cooling-coil', label: 'setpoint' });
  }

  // --- Zones fed by the supply plenum ---
  const zoneEntries = idealLoads.length > 0
    ? idealLoads.map((object) => ({
      name: textField(object, 0, ''),
      thermostat: textField(object, 1, ''),
      heatingLimit: textField(object, 7, 'NoLimit'),
      coolingLimit: textField(object, 10, 'NoLimit'),
    }))
    : zones.map((zone) => ({
      name: zone.name, thermostat: '', heatingLimit: 'NoLimit', coolingLimit: 'NoLimit',
    }));

  zoneEntries.forEach((entry, index) => {
    const zone = zones.find((candidate) => candidate.name.toLowerCase() === entry.name.toLowerCase());
    const id = `zone-${index}`;
    nodes.push({
      id,
      kind: 'zone',
      label: entry.name || `Zone ${index + 1}`,
      detail: [
        ['Floor area', zone ? `${zone.floorArea.toFixed(0)} m²` : '—'],
        ['Volume', zone ? `${zone.volume.toFixed(0)} m³` : '—'],
        ['Heating limit', entry.heatingLimit],
        ['Cooling limit', entry.coolingLimit],
      ],
      position: { x: 6 * COLUMN, y: index * ZONE_ROW - ((zoneEntries.length - 1) * ZONE_ROW) / 2 },
      hasInput: true,
      hasOutput: true,
    });
    connections.push({ from: 'supply', to: id, label: 'supply air' });
  });

  // --- Return path back to the mixing box ---
  nodes.push({
    id: 'return',
    kind: 'return',
    label: 'Return Plenum',
    detail: [['Path', 'Zones → mixing box']],
    position: { x: 7 * COLUMN, y: 0 },
    hasInput: true,
    hasOutput: true,
  });
  for (let index = 0; index < zoneEntries.length; index++) {
    connections.push({ from: `zone-${index}`, to: 'return', label: 'return air' });
  }

  nodes.push({
    id: 'exhaust',
    kind: 'exhaust',
    label: 'Relief Air',
    detail: [['Fraction', 'Balances outdoor air']],
    position: { x: 7 * COLUMN, y: ROW + 60 },
    hasInput: true,
    hasOutput: false,
  });
  connections.push({ from: 'return', to: 'exhaust' });

  return { nodes, connections, inferred };
}

function formatSetpoint(constant: number, scheduleName: string): string {
  if (Number.isFinite(constant) && constant !== 0) return `${constant} °C`;
  if (scheduleName) return scheduleName;
  return 'Not set';
}

function coolingDetail(idealLoads: ReturnType<typeof objectsOfClass>): [string, string][] {
  const first = idealLoads[0];
  if (!first) return [['Type', 'Ideal (implied)'], ['Supply air', '13 °C']];
  return [
    ['Min supply air', `${numericField(first, 4, 13)} °C`],
    ['Limit', textField(first, 10, 'NoLimit')],
  ];
}

function heatingDetail(idealLoads: ReturnType<typeof objectsOfClass>): [string, string][] {
  const first = idealLoads[0];
  if (!first) return [['Type', 'Ideal (implied)'], ['Supply air', '50 °C']];
  return [
    ['Max supply air', `${numericField(first, 3, 50)} °C`],
    ['Limit', textField(first, 7, 'NoLimit')],
  ];
}

/** Accent colour per node kind, as an HSL token reference. */
export function nodeAccent(kind: NodeKind): string {
  switch (kind) {
    case 'outdoor-air': return 'var(--chart-6)';
    case 'cooling-coil': return 'var(--chart-1)';
    case 'heating-coil': return 'var(--chart-2)';
    case 'fan': return 'var(--chart-4)';
    case 'zone': return 'var(--chart-3)';
    case 'thermostat': return 'var(--chart-5)';
    default: return 'var(--muted-foreground)';
  }
}
