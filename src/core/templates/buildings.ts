/**
 * Starter models.
 *
 * These generate complete, valid IDF text so the app has something real to open
 * with no file and no network. Each template is parametric: the same generator
 * produces the single-zone box and the five-zone prototype layout.
 */

import {
  type Point2, type Vertex, type WallSpec, type Orientation,
  rectangleFootprint, wallsFromFootprint, roofVertices, floorVertices,
  windowOnWall, orientationName, formatVertex,
} from './geometry';
import { CLIMATE_LOCATIONS, findLocation } from '@/core/model/climate';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: 'Office' | 'Residential' | 'Retail' | 'Industrial' | 'Education';
  floorArea: number;
  zoneCount: number;
  build(locationId: string): string;
}

export interface ZoneSpec {
  name: string;
  footprint: Point2[];
  /** Footprint edge indices that face outdoors; the rest are partitions. */
  exteriorEdges: number[];
  baseZ: number;
  height: number;
  windowToWallRatio: number;
  /**
   * Glazing for walls facing one way, overriding the zone's own figure. A side
   * that is absent here simply follows `windowToWallRatio`.
   */
  windowToWallRatioBySide?: Partial<Record<Orientation, number>>;
  /** Roof, or a ceiling to the storey above. */
  topIsRoof: boolean;
  /**
   * Set on an upper storey that overhangs open air, so its floor faces
   * outdoors instead of the adiabatic default. Ground floors ignore it.
   */
  exposedFloor?: boolean;
  lightingWattsPerArea: number;
  equipmentWattsPerArea: number;
  areaPerPerson: number;
}

export interface BuildingSpec {
  name: string;
  locationId: string;
  zones: ZoneSpec[];
  northAxis?: number;
}

// ---------------------------------------------------------------- IDF blocks

function header(name: string): string {
  return `!-   Envelop starter model
!-   ${name}
!-   Units: SI (metres, watts, degrees Celsius)

Version,
  24.1;                            !- Version Identifier

SimulationControl,
  No,                              !- Do Zone Sizing Calculation
  No,                              !- Do System Sizing Calculation
  No,                              !- Do Plant Sizing Calculation
  No,                              !- Run Simulation for Sizing Periods
  Yes;                             !- Run Simulation for Weather File Run Periods

Timestep,
  6;                               !- Number of Timesteps per Hour

GlobalGeometryRules,
  UpperLeftCorner,                 !- Starting Vertex Position
  Counterclockwise,                !- Vertex Entry Direction
  World;                           !- Coordinate System
`;
}

function siteBlock(locationId: string): string {
  const location = findLocation(locationId) ?? CLIMATE_LOCATIONS[0];
  return `
Site:Location,
  ${location.city},                            !- Name
  ${location.latitude},                        !- Latitude {deg}
  ${location.longitude},                       !- Longitude {deg}
  ${location.timeZone},                        !- Time Zone {hr}
  ${location.elevation};                       !- Elevation {m}

RunPeriod,
  Annual Run,                      !- Name
  1,                               !- Begin Month
  1,                               !- Begin Day of Month
  ,                                !- Begin Year
  12,                              !- End Month
  31,                              !- End Day of Month
  ,                                !- End Year
  Sunday,                          !- Day of Week for Start Day
  Yes,                             !- Use Weather File Holidays and Special Days
  Yes,                             !- Use Weather File Daylight Saving Period
  No,                              !- Apply Weekend Holiday Rule
  Yes,                             !- Use Weather File Rain Indicators
  Yes;                             !- Use Weather File Snow Indicators
`;
}

/** Materials and assemblies shared by every template. */
function constructionLibrary(): string {
  return `
!-   ===========  MATERIALS  ===========

Material,
  Brick Outer,                     !- Name
  MediumRough,                     !- Roughness
  0.1,                             !- Thickness {m}
  0.89,                            !- Conductivity {W/m-K}
  1920,                            !- Density {kg/m3}
  790,                             !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.7,                             !- Solar Absorptance
  0.7;                             !- Visible Absorptance

Material,
  Insulation Board,                !- Name
  MediumRough,                     !- Roughness
  0.08,                            !- Thickness {m}
  0.035,                           !- Conductivity {W/m-K}
  32,                              !- Density {kg/m3}
  1200,                            !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.6,                             !- Solar Absorptance
  0.6;                             !- Visible Absorptance

Material,
  Concrete Block,                  !- Name
  MediumRough,                     !- Roughness
  0.2,                             !- Thickness {m}
  1.31,                            !- Conductivity {W/m-K}
  2240,                            !- Density {kg/m3}
  880,                             !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.65,                            !- Solar Absorptance
  0.65;                            !- Visible Absorptance

Material,
  Gypsum Board,                    !- Name
  Smooth,                          !- Roughness
  0.016,                           !- Thickness {m}
  0.16,                            !- Conductivity {W/m-K}
  800,                             !- Density {kg/m3}
  1090,                            !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.5,                             !- Solar Absorptance
  0.5;                             !- Visible Absorptance

Material,
  Roof Membrane,                   !- Name
  VeryRough,                       !- Roughness
  0.0095,                          !- Thickness {m}
  0.16,                            !- Conductivity {W/m-K}
  1121,                            !- Density {kg/m3}
  1460,                            !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.7,                             !- Solar Absorptance
  0.7;                             !- Visible Absorptance

Material,
  Roof Insulation,                 !- Name
  MediumRough,                     !- Roughness
  0.15,                            !- Thickness {m}
  0.035,                           !- Conductivity {W/m-K}
  32,                              !- Density {kg/m3}
  1200,                            !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.6,                             !- Solar Absorptance
  0.6;                             !- Visible Absorptance

Material,
  Floor Slab,                      !- Name
  MediumRough,                     !- Roughness
  0.15,                            !- Thickness {m}
  1.73,                            !- Conductivity {W/m-K}
  2243,                            !- Density {kg/m3}
  837,                             !- Specific Heat {J/kg-K}
  0.9,                             !- Thermal Absorptance
  0.65,                            !- Solar Absorptance
  0.65;                            !- Visible Absorptance

Material:NoMass,
  Floor Insulation,                !- Name
  Rough,                           !- Roughness
  1.5,                             !- Thermal Resistance {m2-K/W}
  0.9,                             !- Thermal Absorptance
  0.7,                             !- Solar Absorptance
  0.7;                             !- Visible Absorptance

Material:AirGap,
  Wall Cavity,                     !- Name
  0.18;                            !- Thermal Resistance {m2-K/W}

WindowMaterial:Glazing,
  Clear Glass 3mm,                 !- Name
  SpectralAverage,                 !- Optical Data Type
  ,                                !- Window Glass Spectral Data Set Name
  0.003,                           !- Thickness {m}
  0.837,                           !- Solar Transmittance at Normal Incidence
  0.075,                           !- Front Side Solar Reflectance at Normal Incidence
  0.075,                           !- Back Side Solar Reflectance at Normal Incidence
  0.898,                           !- Visible Transmittance at Normal Incidence
  0.081,                           !- Front Side Visible Reflectance at Normal Incidence
  0.081,                           !- Back Side Visible Reflectance at Normal Incidence
  0,                               !- Infrared Transmittance at Normal Incidence
  0.84,                            !- Front Side Infrared Hemispherical Emissivity
  0.84,                            !- Back Side Infrared Hemispherical Emissivity
  0.9;                             !- Conductivity {W/m-K}

WindowMaterial:Glazing,
  Low-E Glass 6mm,                 !- Name
  SpectralAverage,                 !- Optical Data Type
  ,                                !- Window Glass Spectral Data Set Name
  0.006,                           !- Thickness {m}
  0.60,                            !- Solar Transmittance at Normal Incidence
  0.17,                            !- Front Side Solar Reflectance at Normal Incidence
  0.22,                            !- Back Side Solar Reflectance at Normal Incidence
  0.80,                            !- Visible Transmittance at Normal Incidence
  0.10,                            !- Front Side Visible Reflectance at Normal Incidence
  0.11,                            !- Back Side Visible Reflectance at Normal Incidence
  0,                               !- Infrared Transmittance at Normal Incidence
  0.84,                            !- Front Side Infrared Hemispherical Emissivity
  0.10,                            !- Back Side Infrared Hemispherical Emissivity
  0.9;                             !- Conductivity {W/m-K}

WindowMaterial:Gas,
  Argon Fill 13mm,                 !- Name
  Argon,                           !- Gas Type
  0.0127;                          !- Thickness {m}

!-   ===========  CONSTRUCTIONS  ===========

Construction,
  Exterior Wall,                   !- Name
  Brick Outer,                     !- Outside Layer
  Insulation Board,                !- Layer 2
  Wall Cavity,                     !- Layer 3
  Concrete Block,                  !- Layer 4
  Gypsum Board;                    !- Layer 5

Construction,
  Interior Partition,              !- Name
  Gypsum Board,                    !- Outside Layer
  Wall Cavity,                     !- Layer 2
  Gypsum Board;                    !- Layer 3

Construction,
  Exterior Roof,                   !- Name
  Roof Membrane,                   !- Outside Layer
  Roof Insulation,                 !- Layer 2
  Concrete Block,                  !- Layer 3
  Gypsum Board;                    !- Layer 4

Construction,
  Interior Ceiling,                !- Name
  Concrete Block,                  !- Outside Layer
  Gypsum Board;                    !- Layer 2

Construction,
  Ground Floor,                    !- Name
  Floor Insulation,                !- Outside Layer
  Floor Slab;                      !- Layer 2

Construction,
  Interior Floor,                  !- Name
  Floor Slab;                      !- Outside Layer

Construction,
  Double Low-E Window,             !- Name
  Low-E Glass 6mm,                 !- Outside Layer
  Argon Fill 13mm,                 !- Layer 2
  Clear Glass 3mm;                 !- Layer 3
`;
}

/** Operating schedules shared by every template. */
function scheduleLibrary(): string {
  return `
!-   ===========  SCHEDULES  ===========

ScheduleTypeLimits,
  Fraction,                        !- Name
  0,                               !- Lower Limit Value
  1,                               !- Upper Limit Value
  Continuous,                      !- Numeric Type
  Dimensionless;                   !- Unit Type

ScheduleTypeLimits,
  Temperature,                     !- Name
  -60,                             !- Lower Limit Value
  200,                             !- Upper Limit Value
  Continuous,                      !- Numeric Type
  Temperature;                     !- Unit Type

ScheduleTypeLimits,
  Any Number;                      !- Name

Schedule:Compact,
  Office Occupancy,                !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: Weekdays,
  Until: 07:00, 0.0,
  Until: 08:00, 0.25,
  Until: 12:00, 0.95,
  Until: 13:00, 0.60,
  Until: 17:00, 0.95,
  Until: 19:00, 0.30,
  Until: 24:00, 0.05,
  For: Saturday,
  Until: 08:00, 0.0,
  Until: 14:00, 0.20,
  Until: 24:00, 0.0,
  For: AllOtherDays,
  Until: 24:00, 0.0;

Schedule:Compact,
  Office Lighting,                 !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: Weekdays,
  Until: 06:00, 0.05,
  Until: 08:00, 0.35,
  Until: 18:00, 0.90,
  Until: 20:00, 0.50,
  Until: 24:00, 0.10,
  For: Saturday,
  Until: 08:00, 0.05,
  Until: 14:00, 0.30,
  Until: 24:00, 0.05,
  For: AllOtherDays,
  Until: 24:00, 0.05;

Schedule:Compact,
  Office Equipment,                !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: Weekdays,
  Until: 07:00, 0.30,
  Until: 18:00, 0.90,
  Until: 24:00, 0.40,
  For: AllOtherDays,
  Until: 24:00, 0.30;

Schedule:Compact,
  Residential Occupancy,           !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: AllDays,
  Until: 06:00, 1.00,
  Until: 08:00, 0.80,
  Until: 16:00, 0.35,
  Until: 22:00, 0.90,
  Until: 24:00, 1.00;

Schedule:Compact,
  Always On,                       !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: AllDays,
  Until: 24:00, 1.0;

Schedule:Compact,
  Infiltration Schedule,           !- Name
  Fraction,                        !- Schedule Type Limits Name
  Through: 12/31,
  For: AllDays,
  Until: 24:00, 1.0;

Schedule:Compact,
  Activity Level,                  !- Name
  Any Number,                      !- Schedule Type Limits Name
  Through: 12/31,
  For: AllDays,
  Until: 24:00, 120;

Schedule:Compact,
  Heating Setpoints,               !- Name
  Temperature,                     !- Schedule Type Limits Name
  Through: 12/31,
  For: Weekdays,
  Until: 06:00, 16.0,
  Until: 19:00, 21.0,
  Until: 24:00, 16.0,
  For: AllOtherDays,
  Until: 24:00, 16.0;

Schedule:Compact,
  Cooling Setpoints,               !- Name
  Temperature,                     !- Schedule Type Limits Name
  Through: 12/31,
  For: Weekdays,
  Until: 06:00, 28.0,
  Until: 19:00, 24.0,
  Until: 24:00, 28.0,
  For: AllOtherDays,
  Until: 24:00, 28.0;
`;
}

function outputBlock(): string {
  return `
!-   ===========  OUTPUT  ===========

HVACTemplate:Thermostat,
  Standard Thermostat,             !- Name
  Heating Setpoints,               !- Heating Setpoint Schedule Name
  21.0,                            !- Constant Heating Setpoint {C}
  Cooling Setpoints,               !- Cooling Setpoint Schedule Name
  24.0;                            !- Constant Cooling Setpoint {C}

Output:Variable,
  *,                               !- Key Value
  Zone Mean Air Temperature,       !- Variable Name
  Hourly;                          !- Reporting Frequency

Output:Variable,
  *,                               !- Key Value
  Zone Ideal Loads Supply Air Total Heating Rate,  !- Variable Name
  Hourly;                          !- Reporting Frequency

Output:Variable,
  *,                               !- Key Value
  Zone Ideal Loads Supply Air Total Cooling Rate,  !- Variable Name
  Hourly;                          !- Reporting Frequency

Output:Meter,
  Electricity:Facility,            !- Key Name
  Monthly;                         !- Reporting Frequency

Output:Meter,
  NaturalGas:Facility,             !- Key Name
  Monthly;                         !- Reporting Frequency

OutputControl:Table:Style,
  HTML,                            !- Column Separator
  JtoKWH;                          !- Unit Conversion

Output:Table:SummaryReports,
  AllSummary;                      !- Report 1 Name
`;
}

// ------------------------------------------------------------ Zone generation

function zoneBlock(zone: ZoneSpec): string {
  const parts: string[] = [];
  const walls: WallSpec[] = wallsFromFootprint(zone.footprint, zone.baseZ, zone.height);
  const topZ = zone.baseZ + zone.height;

  parts.push(`
Zone,
  ${zone.name},                    !- Name
  0,                               !- Direction of Relative North {deg}
  0,                               !- X Origin {m}
  0,                               !- Y Origin {m}
  0,                               !- Z Origin {m}
  1,                               !- Type
  1,                               !- Multiplier
  ${zone.height},                  !- Ceiling Height {m}
  autocalculate,                   !- Volume {m3}
  autocalculate;                   !- Floor Area {m2}
`);

  const exterior = new Set(zone.exteriorEdges);

  /** A wall's own glazing: its side's figure when there is one, else the zone's. */
  const glazingOf = (wall: WallSpec): number =>
    zone.windowToWallRatioBySide?.[orientationName(wall.azimuth)] ?? zone.windowToWallRatio;

  // Names are assigned up front because the compass label alone is not unique:
  // any footprint that turns a corner and comes back — an L, a U, anything
  // traced from a real plan — faces the same way twice, and two surfaces with
  // one name is a hard error in EnergyPlus. Rectangles are unaffected, so the
  // built-in templates keep their plain `Wall N` / `Wall S` names.
  const usedWallNames = new Set<string>();
  const wallNames = walls.map((wall, index) => {
    const base = exterior.has(index)
      ? `${zone.name} Wall ${orientationName(wall.azimuth)}`
      : `${zone.name} Wall Int${index + 1}`;
    let name = base;
    for (let suffix = 2; usedWallNames.has(name); suffix++) name = `${base} ${suffix}`;
    usedWallNames.add(name);
    return name;
  });

  walls.forEach((wall, index) => {
    const isExterior = exterior.has(index);
    const wallName = wallNames[index];
    const construction = isExterior ? 'Exterior Wall' : 'Interior Partition';
    const boundary = isExterior ? 'Outdoors' : 'Adiabatic';
    const sun = isExterior ? 'SunExposed' : 'NoSun';
    const wind = isExterior ? 'WindExposed' : 'NoWind';

    parts.push(`
BuildingSurface:Detailed,
  ${wallName},                     !- Name
  Wall,                            !- Surface Type
  ${construction},                 !- Construction Name
  ${zone.name},                    !- Zone Name
  ,                                !- Space Name
  ${boundary},                     !- Outside Boundary Condition
  ,                                !- Outside Boundary Condition Object
  ${sun},                          !- Sun Exposure
  ${wind},                         !- Wind Exposure
  autocalculate,                   !- View Factor to Ground
  4,                               !- Number of Vertices
  ${wall.vertices.map(formatVertex).join(',\n  ')};
`);

    const glazing = glazingOf(wall);
    if (isExterior && glazing > 0) {
      const opening = windowOnWall(wall, glazing);
      if (opening) {
        parts.push(`
FenestrationSurface:Detailed,
  ${wallName} Window,              !- Name
  Window,                          !- Surface Type
  Double Low-E Window,             !- Construction Name
  ${wallName},                     !- Building Surface Name
  ,                                !- Outside Boundary Condition Object
  autocalculate,                   !- View Factor to Ground
  ,                                !- Frame and Divider Name
  1,                               !- Multiplier
  4,                               !- Number of Vertices
  ${opening.map(formatVertex).join(',\n  ')};
`);
      }
    }
  });

  const roofConstruction = zone.topIsRoof ? 'Exterior Roof' : 'Interior Ceiling';
  const roofBoundary = zone.topIsRoof ? 'Outdoors' : 'Adiabatic';
  const roofType = zone.topIsRoof ? 'Roof' : 'Ceiling';
  const roof: Vertex[] = roofVertices(zone.footprint, topZ);

  parts.push(`
BuildingSurface:Detailed,
  ${zone.name} Roof,               !- Name
  ${roofType},                     !- Surface Type
  ${roofConstruction},             !- Construction Name
  ${zone.name},                    !- Zone Name
  ,                                !- Space Name
  ${roofBoundary},                 !- Outside Boundary Condition
  ,                                !- Outside Boundary Condition Object
  ${zone.topIsRoof ? 'SunExposed' : 'NoSun'},  !- Sun Exposure
  ${zone.topIsRoof ? 'WindExposed' : 'NoWind'},!- Wind Exposure
  autocalculate,                   !- View Factor to Ground
  4,                               !- Number of Vertices
  ${roof.map(formatVertex).join(',\n  ')};
`);

  const onGround = zone.baseZ <= 0.01;
  const exposed = !onGround && zone.exposedFloor === true;
  const floor: Vertex[] = floorVertices(zone.footprint, zone.baseZ);

  // An exposed soffit keeps the insulated slab build-up but faces the weather.
  // It is never sun exposed: it points down.
  const floorConstruction = onGround || exposed ? 'Ground Floor' : 'Interior Floor';
  const floorBoundary = onGround ? 'Ground' : exposed ? 'Outdoors' : 'Adiabatic';

  parts.push(`
BuildingSurface:Detailed,
  ${zone.name} Floor,              !- Name
  Floor,                           !- Surface Type
  ${floorConstruction},            !- Construction Name
  ${zone.name},                    !- Zone Name
  ,                                !- Space Name
  ${floorBoundary},                !- Outside Boundary Condition
  ,                                !- Outside Boundary Condition Object
  NoSun,                           !- Sun Exposure
  ${exposed ? 'WindExposed' : 'NoWind'},  !- Wind Exposure
  autocalculate,                   !- View Factor to Ground
  4,                               !- Number of Vertices
  ${floor.map(formatVertex).join(',\n  ')};
`);

  return parts.join('');
}

function loadsBlock(zone: ZoneSpec, residential: boolean): string {
  const occupancy = residential ? 'Residential Occupancy' : 'Office Occupancy';
  const lighting = residential ? 'Residential Occupancy' : 'Office Lighting';
  const equipment = residential ? 'Residential Occupancy' : 'Office Equipment';

  return `
People,
  ${zone.name} People,             !- Name
  ${zone.name},                    !- Zone or ZoneList or Space or SpaceList Name
  ${occupancy},                    !- Number of People Schedule Name
  Area/Person,                     !- Number of People Calculation Method
  ,                                !- Number of People
  ,                                !- People per Floor Area {person/m2}
  ${zone.areaPerPerson},           !- Floor Area per Person {m2/person}
  0.3,                             !- Fraction Radiant
  autocalculate,                   !- Sensible Heat Fraction
  Activity Level;                  !- Activity Level Schedule Name

Lights,
  ${zone.name} Lights,             !- Name
  ${zone.name},                    !- Zone or ZoneList or Space or SpaceList Name
  ${lighting},                     !- Schedule Name
  Watts/Area,                      !- Design Level Calculation Method
  ,                                !- Lighting Level {W}
  ${zone.lightingWattsPerArea},    !- Watts per Floor Area {W/m2}
  ,                                !- Watts per Person {W/person}
  0,                               !- Return Air Fraction
  0.42,                            !- Fraction Radiant
  0.18,                            !- Fraction Visible
  1,                               !- Fraction Replaceable
  General;                         !- End-Use Subcategory

ElectricEquipment,
  ${zone.name} Equipment,          !- Name
  ${zone.name},                    !- Zone or ZoneList or Space or SpaceList Name
  ${equipment},                    !- Schedule Name
  Watts/Area,                      !- Design Level Calculation Method
  ,                                !- Design Level {W}
  ${zone.equipmentWattsPerArea},   !- Watts per Floor Area {W/m2}
  ,                                !- Watts per Person {W/person}
  0,                               !- Fraction Latent
  0.3,                             !- Fraction Radiant
  0,                               !- Fraction Lost
  General;                         !- End-Use Subcategory

ZoneInfiltration:DesignFlowRate,
  ${zone.name} Infiltration,       !- Name
  ${zone.name},                    !- Zone or ZoneList or Space or SpaceList Name
  Infiltration Schedule,           !- Schedule Name
  AirChanges/Hour,                 !- Design Flow Rate Calculation Method
  ,                                !- Design Flow Rate {m3/s}
  ,                                !- Flow Rate per Floor Area {m3/s-m2}
  ,                                !- Flow Rate per Exterior Surface Area {m3/s-m2}
  0.4,                             !- Air Changes per Hour {1/hr}
  1,                               !- Constant Term Coefficient
  0,                               !- Temperature Term Coefficient
  0,                               !- Velocity Term Coefficient
  0;                               !- Velocity Squared Term Coefficient

HVACTemplate:Zone:IdealLoadsAirSystem,
  ${zone.name},                    !- Zone Name
  Standard Thermostat,             !- Template Thermostat Name
  Always On,                       !- System Availability Schedule Name
  50,                              !- Maximum Heating Supply Air Temperature {C}
  13,                              !- Minimum Cooling Supply Air Temperature {C}
  0.0156,                          !- Maximum Heating Supply Air Humidity Ratio
  0.0077,                          !- Minimum Cooling Supply Air Humidity Ratio
  NoLimit,                         !- Heating Limit
  ,                                !- Maximum Heating Air Flow Rate {m3/s}
  ,                                !- Maximum Sensible Heating Capacity {W}
  NoLimit;                         !- Cooling Limit
`;
}

export function assemble(spec: BuildingSpec, residential: boolean): string {
  const parts: string[] = [
    header(spec.name),
    `
Building,
  ${spec.name},                    !- Name
  ${spec.northAxis ?? 0},          !- North Axis {deg}
  City,                            !- Terrain
  0.04,                            !- Loads Convergence Tolerance Value {W}
  0.4,                             !- Temperature Convergence Tolerance Value {deltaC}
  FullExterior,                    !- Solar Distribution
  25,                              !- Maximum Number of Warmup Days
  6;                               !- Minimum Number of Warmup Days
`,
    siteBlock(spec.locationId),
    constructionLibrary(),
    scheduleLibrary(),
    '\n!-   ===========  ZONES AND SURFACES  ===========\n',
  ];

  for (const zone of spec.zones) parts.push(zoneBlock(zone));
  parts.push('\n!-   ===========  INTERNAL GAINS AND HVAC  ===========\n');
  for (const zone of spec.zones) parts.push(loadsBlock(zone, residential));
  parts.push(outputBlock());

  return parts.join('');
}

// -------------------------------------------------------------- The templates

/** Core plus four perimeter zones, the standard prototype layout. */
function fiveZoneFootprints(width: number, depth: number, perimeter: number): {
  name: string; footprint: Point2[]; exteriorEdges: number[];
}[] {
  const w = width;
  const d = depth;
  const p = perimeter;
  return [
    { name: 'Perimeter_South', exteriorEdges: [0],
      footprint: [[0, 0], [w, 0], [w - p, p], [p, p]] },
    { name: 'Perimeter_East', exteriorEdges: [0],
      footprint: [[w, 0], [w, d], [w - p, d - p], [w - p, p]] },
    { name: 'Perimeter_North', exteriorEdges: [0],
      footprint: [[w, d], [0, d], [p, d - p], [w - p, d - p]] },
    { name: 'Perimeter_West', exteriorEdges: [0],
      footprint: [[0, d], [0, 0], [p, p], [p, d - p]] },
    { name: 'Core', exteriorEdges: [],
      footprint: [[p, p], [w - p, p], [w - p, d - p], [p, d - p]] },
  ];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'small-office',
    name: 'Small Office',
    description: 'A single open-plan zone, 15 m x 10 m with 30% glazing. The quickest model to reason about.',
    category: 'Office',
    floorArea: 150,
    zoneCount: 1,
    build: (locationId) => assemble({
      name: 'Small Office',
      locationId,
      zones: [{
        name: 'Office_ZN',
        footprint: rectangleFootprint(0, 0, 15, 10),
        exteriorEdges: [0, 1, 2, 3],
        baseZ: 0, height: 3.0,
        windowToWallRatio: 0.30,
        topIsRoof: true,
        lightingWattsPerArea: 9.0,
        equipmentWattsPerArea: 8.0,
        areaPerPerson: 18,
      }],
    }, false),
  },
  {
    id: 'five-zone-office',
    name: 'Five-Zone Office',
    description: 'Core and four perimeter zones over 30 m x 20 m. Shows how orientation drives each facade differently.',
    category: 'Office',
    floorArea: 600,
    zoneCount: 5,
    build: (locationId) => assemble({
      name: 'Five Zone Office',
      locationId,
      zones: fiveZoneFootprints(30, 20, 4.57).map((zone) => ({
        ...zone,
        baseZ: 0, height: 3.05,
        windowToWallRatio: zone.exteriorEdges.length > 0 ? 0.33 : 0,
        topIsRoof: true,
        lightingWattsPerArea: 9.5,
        equipmentWattsPerArea: 8.5,
        areaPerPerson: 16,
      })),
    }, false),
  },
  {
    id: 'apartment',
    name: 'Apartment Block',
    description: 'Six dwellings over two storeys, with residential schedules and lower plug loads.',
    category: 'Residential',
    floorArea: 480,
    zoneCount: 6,
    build: (locationId) => {
      const zones: ZoneSpec[] = [];
      const unitWidth = 8;
      const unitDepth = 10;
      const storeyHeight = 2.9;
      for (let storey = 0; storey < 2; storey++) {
        for (let unit = 0; unit < 3; unit++) {
          // Only the end units have exposed side walls.
          const exteriorEdges = [0, 2];
          if (unit === 0) exteriorEdges.push(3);
          if (unit === 2) exteriorEdges.push(1);
          zones.push({
            name: `Unit_${storey + 1}0${unit + 1}`,
            footprint: rectangleFootprint(unit * unitWidth, 0, unitWidth, unitDepth),
            exteriorEdges,
            baseZ: storey * storeyHeight,
            height: storeyHeight,
            windowToWallRatio: 0.25,
            topIsRoof: storey === 1,
            lightingWattsPerArea: 5.0,
            equipmentWattsPerArea: 6.0,
            areaPerPerson: 32,
          });
        }
      }
      return assemble({ name: 'Apartment Block', locationId, zones }, true);
    },
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    description: 'A 40 m x 25 m high-bay space with minimal glazing, dominated by envelope and infiltration losses.',
    category: 'Industrial',
    floorArea: 1000,
    zoneCount: 1,
    build: (locationId) => assemble({
      name: 'Warehouse',
      locationId,
      zones: [{
        name: 'Storage_ZN',
        footprint: rectangleFootprint(0, 0, 40, 25),
        exteriorEdges: [0, 1, 2, 3],
        baseZ: 0, height: 7.0,
        windowToWallRatio: 0.04,
        topIsRoof: true,
        lightingWattsPerArea: 6.0,
        equipmentWattsPerArea: 2.0,
        areaPerPerson: 200,
      }],
    }, false),
  },
  {
    id: 'classroom',
    name: 'Classroom Wing',
    description: 'Four south-facing classrooms with high occupancy and heavy daytime internal gains.',
    category: 'Education',
    floorArea: 360,
    zoneCount: 4,
    build: (locationId) => {
      const zones: ZoneSpec[] = [];
      for (let room = 0; room < 4; room++) {
        const exteriorEdges = [0, 2];
        if (room === 0) exteriorEdges.push(3);
        if (room === 3) exteriorEdges.push(1);
        zones.push({
          name: `Classroom_${room + 1}`,
          footprint: rectangleFootprint(room * 9, 0, 9, 10),
          exteriorEdges,
          baseZ: 0, height: 3.4,
          windowToWallRatio: 0.35,
          topIsRoof: true,
          lightingWattsPerArea: 10.5,
          equipmentWattsPerArea: 5.0,
          areaPerPerson: 3.5,
        });
      }
      return assemble({ name: 'Classroom Wing', locationId, zones }, false);
    },
  },
];

export function findTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((entry) => entry.id === id);
}

export const DEFAULT_TEMPLATE_ID = 'five-zone-office';
