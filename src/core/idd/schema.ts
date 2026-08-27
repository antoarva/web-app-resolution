/**
 * A working subset of the EnergyPlus Input Data Dictionary.
 *
 * The real IDD is a ~15 MB file describing every input class. Shipping it
 * whole would dominate the offline bundle, so this covers the classes the
 * editor understands well enough to give typed field editors, units and
 * validation. Unknown classes still load and save — they just fall back to a
 * generic string editor.
 */

export type FieldType = 'alpha' | 'numeric' | 'integer' | 'choice' | 'object-list' | 'node';

export interface IddField {
  name: string;
  type: FieldType;
  units?: string;
  default?: string;
  choices?: string[];
  /** Class names whose objects are valid values, for `object-list` fields. */
  references?: string[];
  required?: boolean;
  autosizable?: boolean;
  minimum?: number;
  maximum?: number;
  note?: string;
}

export interface IddClass {
  name: string;
  group: string;
  memo: string;
  /** Repeating tail fields, e.g. surface vertices. */
  extensible?: { size: number; startIndex: number };
  fields: IddField[];
}

const classes: IddClass[] = [
  // ---------------------------------------------------------------- Simulation
  {
    name: 'Version',
    group: 'Simulation Parameters',
    memo: 'Specifies the EnergyPlus version the file targets.',
    fields: [{ name: 'Version Identifier', type: 'alpha', default: '24.1', required: true }],
  },
  {
    name: 'SimulationControl',
    group: 'Simulation Parameters',
    memo: 'Selects which sizing and simulation phases run.',
    fields: [
      { name: 'Do Zone Sizing Calculation', type: 'choice', choices: ['Yes', 'No'], default: 'No' },
      { name: 'Do System Sizing Calculation', type: 'choice', choices: ['Yes', 'No'], default: 'No' },
      { name: 'Do Plant Sizing Calculation', type: 'choice', choices: ['Yes', 'No'], default: 'No' },
      { name: 'Run Simulation for Sizing Periods', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
      { name: 'Run Simulation for Weather File Run Periods', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
    ],
  },
  {
    name: 'Building',
    group: 'Simulation Parameters',
    memo: 'Describes the building as a whole and its orientation.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'North Axis', type: 'numeric', units: 'deg', default: '0', minimum: -360, maximum: 360,
        note: 'Rotates the whole model clockwise relative to true north.' },
      { name: 'Terrain', type: 'choice', choices: ['Country', 'Suburbs', 'City', 'Ocean', 'Urban'], default: 'Suburbs' },
      { name: 'Loads Convergence Tolerance Value', type: 'numeric', units: 'W', default: '0.04', minimum: 0 },
      { name: 'Temperature Convergence Tolerance Value', type: 'numeric', units: 'deltaC', default: '0.4', minimum: 0 },
      { name: 'Solar Distribution', type: 'choice',
        choices: ['MinimalShadowing', 'FullExterior', 'FullInteriorAndExterior', 'FullExteriorWithReflections'],
        default: 'FullExterior' },
      { name: 'Maximum Number of Warmup Days', type: 'integer', default: '25', minimum: 1 },
      { name: 'Minimum Number of Warmup Days', type: 'integer', default: '1', minimum: 1 },
    ],
  },
  {
    name: 'Timestep',
    group: 'Simulation Parameters',
    memo: 'Zone timesteps per hour. Six is the usual starting point.',
    fields: [{ name: 'Number of Timesteps per Hour', type: 'integer', default: '6', minimum: 1, maximum: 60 }],
  },
  {
    name: 'Site:Location',
    group: 'Location and Climate',
    memo: 'Site coordinates used for solar position.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Latitude', type: 'numeric', units: 'deg', default: '0', minimum: -90, maximum: 90,
        note: 'Positive north of the equator.' },
      { name: 'Longitude', type: 'numeric', units: 'deg', default: '0', minimum: -180, maximum: 180,
        note: 'Positive east of Greenwich.' },
      { name: 'Time Zone', type: 'numeric', units: 'hr', default: '0', minimum: -12, maximum: 14 },
      { name: 'Elevation', type: 'numeric', units: 'm', default: '0', minimum: -300, maximum: 8900 },
    ],
  },
  {
    name: 'RunPeriod',
    group: 'Location and Climate',
    memo: 'Calendar span the annual simulation covers.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Begin Month', type: 'integer', default: '1', minimum: 1, maximum: 12 },
      { name: 'Begin Day of Month', type: 'integer', default: '1', minimum: 1, maximum: 31 },
      { name: 'Begin Year', type: 'integer' },
      { name: 'End Month', type: 'integer', default: '12', minimum: 1, maximum: 12 },
      { name: 'End Day of Month', type: 'integer', default: '31', minimum: 1, maximum: 31 },
      { name: 'End Year', type: 'integer' },
      { name: 'Day of Week for Start Day', type: 'choice',
        choices: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], default: 'Sunday' },
      { name: 'Use Weather File Holidays and Special Days', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
      { name: 'Use Weather File Daylight Saving Period', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
      { name: 'Apply Weekend Holiday Rule', type: 'choice', choices: ['Yes', 'No'], default: 'No' },
      { name: 'Use Weather File Rain Indicators', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
      { name: 'Use Weather File Snow Indicators', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
    ],
  },
  {
    name: 'GlobalGeometryRules',
    group: 'Surface Construction Elements',
    memo: 'Declares how surface vertices in this file are written.',
    fields: [
      { name: 'Starting Vertex Position', type: 'choice',
        choices: ['UpperLeftCorner', 'LowerLeftCorner', 'UpperRightCorner', 'LowerRightCorner'],
        default: 'UpperLeftCorner', required: true },
      { name: 'Vertex Entry Direction', type: 'choice', choices: ['Counterclockwise', 'Clockwise'],
        default: 'Counterclockwise', required: true },
      { name: 'Coordinate System', type: 'choice', choices: ['Relative', 'World'], default: 'Relative', required: true },
      { name: 'Daylighting Reference Point Coordinate System', type: 'choice', choices: ['Relative', 'World'], default: 'Relative' },
      { name: 'Rectangular Surface Coordinate System', type: 'choice', choices: ['Relative', 'World'], default: 'Relative' },
    ],
  },

  // ------------------------------------------------------------- Constructions
  {
    name: 'Material',
    group: 'Surface Construction Elements',
    memo: 'An opaque layer defined by its thermal properties.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Roughness', type: 'choice',
        choices: ['VeryRough', 'Rough', 'MediumRough', 'MediumSmooth', 'Smooth', 'VerySmooth'],
        default: 'MediumRough', required: true },
      { name: 'Thickness', type: 'numeric', units: 'm', minimum: 0.0001, required: true },
      { name: 'Conductivity', type: 'numeric', units: 'W/m-K', minimum: 0.0001, required: true },
      { name: 'Density', type: 'numeric', units: 'kg/m3', minimum: 0.0001, required: true },
      { name: 'Specific Heat', type: 'numeric', units: 'J/kg-K', minimum: 100, required: true },
      { name: 'Thermal Absorptance', type: 'numeric', default: '0.9', minimum: 0, maximum: 0.99999 },
      { name: 'Solar Absorptance', type: 'numeric', default: '0.7', minimum: 0, maximum: 1 },
      { name: 'Visible Absorptance', type: 'numeric', default: '0.7', minimum: 0, maximum: 1 },
    ],
  },
  {
    name: 'Material:NoMass',
    group: 'Surface Construction Elements',
    memo: 'A layer defined only by its thermal resistance, with no heat capacity.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Roughness', type: 'choice',
        choices: ['VeryRough', 'Rough', 'MediumRough', 'MediumSmooth', 'Smooth', 'VerySmooth'],
        default: 'MediumRough', required: true },
      { name: 'Thermal Resistance', type: 'numeric', units: 'm2-K/W', minimum: 0.001, required: true },
      { name: 'Thermal Absorptance', type: 'numeric', default: '0.9', minimum: 0, maximum: 0.99999 },
      { name: 'Solar Absorptance', type: 'numeric', default: '0.7', minimum: 0, maximum: 1 },
      { name: 'Visible Absorptance', type: 'numeric', default: '0.7', minimum: 0, maximum: 1 },
    ],
  },
  {
    name: 'Material:AirGap',
    group: 'Surface Construction Elements',
    memo: 'A still air cavity, represented as pure resistance.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Thermal Resistance', type: 'numeric', units: 'm2-K/W', default: '0.16', minimum: 0.001, required: true },
    ],
  },
  {
    name: 'WindowMaterial:Glazing',
    group: 'Surface Construction Elements',
    memo: 'A single glass pane with its optical properties.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Optical Data Type', type: 'choice', choices: ['SpectralAverage', 'Spectral'], default: 'SpectralAverage' },
      { name: 'Window Glass Spectral Data Set Name', type: 'alpha' },
      { name: 'Thickness', type: 'numeric', units: 'm', default: '0.003', minimum: 0.0001, required: true },
      { name: 'Solar Transmittance at Normal Incidence', type: 'numeric', default: '0.775', minimum: 0, maximum: 1 },
      { name: 'Front Side Solar Reflectance at Normal Incidence', type: 'numeric', default: '0.071', minimum: 0, maximum: 1 },
      { name: 'Back Side Solar Reflectance at Normal Incidence', type: 'numeric', default: '0.071', minimum: 0, maximum: 1 },
      { name: 'Visible Transmittance at Normal Incidence', type: 'numeric', default: '0.881', minimum: 0, maximum: 1 },
      { name: 'Front Side Visible Reflectance at Normal Incidence', type: 'numeric', default: '0.080', minimum: 0, maximum: 1 },
      { name: 'Back Side Visible Reflectance at Normal Incidence', type: 'numeric', default: '0.080', minimum: 0, maximum: 1 },
      { name: 'Infrared Transmittance at Normal Incidence', type: 'numeric', default: '0', minimum: 0, maximum: 1 },
      { name: 'Front Side Infrared Hemispherical Emissivity', type: 'numeric', default: '0.84', minimum: 0, maximum: 1 },
      { name: 'Back Side Infrared Hemispherical Emissivity', type: 'numeric', default: '0.84', minimum: 0, maximum: 1 },
      { name: 'Conductivity', type: 'numeric', units: 'W/m-K', default: '0.9', minimum: 0 },
    ],
  },
  {
    name: 'WindowMaterial:Gas',
    group: 'Surface Construction Elements',
    memo: 'The gas fill between two panes.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Gas Type', type: 'choice', choices: ['Air', 'Argon', 'Krypton', 'Xenon', 'Custom'],
        default: 'Air', required: true },
      { name: 'Thickness', type: 'numeric', units: 'm', default: '0.0127', minimum: 0.0001, required: true },
    ],
  },
  {
    name: 'Construction',
    group: 'Surface Construction Elements',
    memo: 'An ordered layer stack, listed outside first.',
    extensible: { size: 1, startIndex: 1 },
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Outside Layer', type: 'object-list',
        references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'],
        required: true },
      { name: 'Layer 2', type: 'object-list', references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'] },
      { name: 'Layer 3', type: 'object-list', references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'] },
      { name: 'Layer 4', type: 'object-list', references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'] },
      { name: 'Layer 5', type: 'object-list', references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'] },
      { name: 'Layer 6', type: 'object-list', references: ['Material', 'Material:NoMass', 'Material:AirGap', 'WindowMaterial:Glazing', 'WindowMaterial:Gas'] },
    ],
  },

  // ------------------------------------------------------------------ Geometry
  {
    name: 'Zone',
    group: 'Thermal Zones and Surfaces',
    memo: 'A thermal zone: one well-mixed air volume.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Direction of Relative North', type: 'numeric', units: 'deg', default: '0' },
      { name: 'X Origin', type: 'numeric', units: 'm', default: '0' },
      { name: 'Y Origin', type: 'numeric', units: 'm', default: '0' },
      { name: 'Z Origin', type: 'numeric', units: 'm', default: '0' },
      { name: 'Type', type: 'integer', default: '1' },
      { name: 'Multiplier', type: 'integer', default: '1', minimum: 1,
        note: 'Repeats this zone N times without modelling the geometry again.' },
      { name: 'Ceiling Height', type: 'numeric', units: 'm', autosizable: true, default: 'autocalculate' },
      { name: 'Volume', type: 'numeric', units: 'm3', autosizable: true, default: 'autocalculate' },
      { name: 'Floor Area', type: 'numeric', units: 'm2', autosizable: true, default: 'autocalculate' },
      { name: 'Zone Inside Convection Algorithm', type: 'choice',
        choices: ['', 'Simple', 'TARP', 'CeilingDiffuser', 'AdaptiveConvectionAlgorithm', 'TrombeWall'] },
      { name: 'Zone Outside Convection Algorithm', type: 'choice',
        choices: ['', 'SimpleCombined', 'TARP', 'DOE-2', 'MoWiTT', 'AdaptiveConvectionAlgorithm'] },
      { name: 'Part of Total Floor Area', type: 'choice', choices: ['Yes', 'No'], default: 'Yes' },
    ],
  },
  {
    name: 'BuildingSurface:Detailed',
    group: 'Thermal Zones and Surfaces',
    memo: 'An opaque envelope or partition surface given by its vertices.',
    extensible: { size: 3, startIndex: 11 },
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Surface Type', type: 'choice', choices: ['Floor', 'Wall', 'Ceiling', 'Roof'], required: true },
      { name: 'Construction Name', type: 'object-list', references: ['Construction'], required: true },
      { name: 'Zone Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Space Name', type: 'alpha' },
      { name: 'Outside Boundary Condition', type: 'choice',
        choices: ['Outdoors', 'Ground', 'Adiabatic', 'Surface', 'Zone', 'OtherSideCoefficients', 'GroundFCfactorMethod'],
        required: true },
      { name: 'Outside Boundary Condition Object', type: 'alpha',
        note: 'The matching surface, when the boundary condition is Surface.' },
      { name: 'Sun Exposure', type: 'choice', choices: ['SunExposed', 'NoSun'], default: 'SunExposed' },
      { name: 'Wind Exposure', type: 'choice', choices: ['WindExposed', 'NoWind'], default: 'WindExposed' },
      { name: 'View Factor to Ground', type: 'numeric', autosizable: true, default: 'autocalculate', minimum: 0, maximum: 1 },
      { name: 'Number of Vertices', type: 'integer', autosizable: true, default: 'autocalculate', minimum: 3 },
    ],
  },
  {
    name: 'FenestrationSurface:Detailed',
    group: 'Thermal Zones and Surfaces',
    memo: 'A window, door or glazed door hosted by a base surface.',
    extensible: { size: 3, startIndex: 9 },
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Surface Type', type: 'choice',
        choices: ['Window', 'Door', 'GlassDoor', 'TubularDaylightDome', 'TubularDaylightDiffuser'], required: true },
      { name: 'Construction Name', type: 'object-list', references: ['Construction'], required: true },
      { name: 'Building Surface Name', type: 'object-list', references: ['BuildingSurface:Detailed'], required: true },
      { name: 'Outside Boundary Condition Object', type: 'alpha' },
      { name: 'View Factor to Ground', type: 'numeric', autosizable: true, default: 'autocalculate', minimum: 0, maximum: 1 },
      { name: 'Frame and Divider Name', type: 'alpha' },
      { name: 'Multiplier', type: 'numeric', default: '1', minimum: 1 },
      { name: 'Number of Vertices', type: 'integer', autosizable: true, default: 'autocalculate', minimum: 3 },
    ],
  },
  {
    name: 'Shading:Building:Detailed',
    group: 'Thermal Zones and Surfaces',
    memo: 'A shading surface fixed to the building, in world coordinates.',
    extensible: { size: 3, startIndex: 3 },
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Transmittance Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'] },
      { name: 'Number of Vertices', type: 'integer', autosizable: true, default: 'autocalculate', minimum: 3 },
    ],
  },

  // ----------------------------------------------------------------- Schedules
  {
    name: 'ScheduleTypeLimits',
    group: 'Schedules',
    memo: 'Bounds and units that a schedule’s values must respect.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Lower Limit Value', type: 'numeric' },
      { name: 'Upper Limit Value', type: 'numeric' },
      { name: 'Numeric Type', type: 'choice', choices: ['Continuous', 'Discrete'], default: 'Continuous' },
      { name: 'Unit Type', type: 'choice',
        choices: ['Dimensionless', 'Temperature', 'DeltaTemperature', 'PrecipitationRate', 'Angle',
          'ConvectionCoefficient', 'ActivityLevel', 'Velocity', 'Capacity', 'Power', 'Availability',
          'Percent', 'Control', 'Mode'],
        default: 'Dimensionless' },
    ],
  },
  {
    name: 'Schedule:Constant',
    group: 'Schedules',
    memo: 'A schedule holding one value all year.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Schedule Type Limits Name', type: 'object-list', references: ['ScheduleTypeLimits'] },
      { name: 'Hourly Value', type: 'numeric', default: '0' },
    ],
  },
  {
    name: 'Schedule:Compact',
    group: 'Schedules',
    memo: 'A schedule written as Through/For/Until rules.',
    extensible: { size: 1, startIndex: 2 },
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Schedule Type Limits Name', type: 'object-list', references: ['ScheduleTypeLimits'] },
    ],
  },

  // ------------------------------------------------------------ Internal gains
  {
    name: 'People',
    group: 'Internal Gains',
    memo: 'Occupancy and the sensible and latent heat it adds.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Zone or ZoneList or Space or SpaceList Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Number of People Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'], required: true },
      { name: 'Number of People Calculation Method', type: 'choice',
        choices: ['People', 'People/Area', 'Area/Person'], default: 'People', required: true },
      { name: 'Number of People', type: 'numeric', minimum: 0 },
      { name: 'People per Floor Area', type: 'numeric', units: 'person/m2', minimum: 0 },
      { name: 'Floor Area per Person', type: 'numeric', units: 'm2/person', minimum: 0 },
      { name: 'Fraction Radiant', type: 'numeric', default: '0.3', minimum: 0, maximum: 1 },
      { name: 'Sensible Heat Fraction', type: 'numeric', autosizable: true, default: 'autocalculate', minimum: 0, maximum: 1 },
      { name: 'Activity Level Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'], required: true },
    ],
  },
  {
    name: 'Lights',
    group: 'Internal Gains',
    memo: 'Electric lighting load and how its heat splits.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Zone or ZoneList or Space or SpaceList Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'], required: true },
      { name: 'Design Level Calculation Method', type: 'choice',
        choices: ['LightingLevel', 'Watts/Area', 'Watts/Person'], default: 'Watts/Area', required: true },
      { name: 'Lighting Level', type: 'numeric', units: 'W', minimum: 0 },
      { name: 'Watts per Floor Area', type: 'numeric', units: 'W/m2', minimum: 0 },
      { name: 'Watts per Person', type: 'numeric', units: 'W/person', minimum: 0 },
      { name: 'Return Air Fraction', type: 'numeric', default: '0', minimum: 0, maximum: 1 },
      { name: 'Fraction Radiant', type: 'numeric', default: '0.42', minimum: 0, maximum: 1 },
      { name: 'Fraction Visible', type: 'numeric', default: '0.18', minimum: 0, maximum: 1 },
      { name: 'Fraction Replaceable', type: 'numeric', default: '1', minimum: 0, maximum: 1 },
      { name: 'End-Use Subcategory', type: 'alpha', default: 'General' },
    ],
  },
  {
    name: 'ElectricEquipment',
    group: 'Internal Gains',
    memo: 'Plug and process loads in a zone.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Zone or ZoneList or Space or SpaceList Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'], required: true },
      { name: 'Design Level Calculation Method', type: 'choice',
        choices: ['EquipmentLevel', 'Watts/Area', 'Watts/Person'], default: 'Watts/Area', required: true },
      { name: 'Design Level', type: 'numeric', units: 'W', minimum: 0 },
      { name: 'Watts per Floor Area', type: 'numeric', units: 'W/m2', minimum: 0 },
      { name: 'Watts per Person', type: 'numeric', units: 'W/person', minimum: 0 },
      { name: 'Fraction Latent', type: 'numeric', default: '0', minimum: 0, maximum: 1 },
      { name: 'Fraction Radiant', type: 'numeric', default: '0', minimum: 0, maximum: 1 },
      { name: 'Fraction Lost', type: 'numeric', default: '0', minimum: 0, maximum: 1 },
      { name: 'End-Use Subcategory', type: 'alpha', default: 'General' },
    ],
  },
  {
    name: 'ZoneInfiltration:DesignFlowRate',
    group: 'Internal Gains',
    memo: 'Unintended outdoor air leaking into a zone.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Zone or ZoneList or Space or SpaceList Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'], required: true },
      { name: 'Design Flow Rate Calculation Method', type: 'choice',
        choices: ['Flow/Zone', 'Flow/Area', 'Flow/ExteriorArea', 'Flow/ExteriorWallArea', 'AirChanges/Hour'],
        default: 'AirChanges/Hour', required: true },
      { name: 'Design Flow Rate', type: 'numeric', units: 'm3/s', minimum: 0 },
      { name: 'Flow Rate per Floor Area', type: 'numeric', units: 'm3/s-m2', minimum: 0 },
      { name: 'Flow Rate per Exterior Surface Area', type: 'numeric', units: 'm3/s-m2', minimum: 0 },
      { name: 'Air Changes per Hour', type: 'numeric', units: '1/hr', minimum: 0 },
      { name: 'Constant Term Coefficient', type: 'numeric', default: '1' },
      { name: 'Temperature Term Coefficient', type: 'numeric', default: '0' },
      { name: 'Velocity Term Coefficient', type: 'numeric', default: '0' },
      { name: 'Velocity Squared Term Coefficient', type: 'numeric', default: '0' },
    ],
  },

  // ---------------------------------------------------------------------- HVAC
  {
    name: 'HVACTemplate:Thermostat',
    group: 'HVAC Templates',
    memo: 'Heating and cooling setpoints for zones that reference it.',
    fields: [
      { name: 'Name', type: 'alpha', required: true },
      { name: 'Heating Setpoint Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'] },
      { name: 'Constant Heating Setpoint', type: 'numeric', units: 'C' },
      { name: 'Cooling Setpoint Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'] },
      { name: 'Constant Cooling Setpoint', type: 'numeric', units: 'C' },
    ],
  },
  {
    name: 'HVACTemplate:Zone:IdealLoadsAirSystem',
    group: 'HVAC Templates',
    memo: 'Supplies whatever heating or cooling the zone needs, with no equipment modelled.',
    fields: [
      { name: 'Zone Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Template Thermostat Name', type: 'object-list', references: ['HVACTemplate:Thermostat'] },
      { name: 'System Availability Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'] },
      { name: 'Maximum Heating Supply Air Temperature', type: 'numeric', units: 'C', default: '50' },
      { name: 'Minimum Cooling Supply Air Temperature', type: 'numeric', units: 'C', default: '13' },
      { name: 'Maximum Heating Supply Air Humidity Ratio', type: 'numeric', units: 'kgWater/kgDryAir', default: '0.0156' },
      { name: 'Minimum Cooling Supply Air Humidity Ratio', type: 'numeric', units: 'kgWater/kgDryAir', default: '0.0077' },
      { name: 'Heating Limit', type: 'choice',
        choices: ['NoLimit', 'LimitFlowRate', 'LimitCapacity', 'LimitFlowRateAndCapacity'], default: 'NoLimit' },
      { name: 'Maximum Heating Air Flow Rate', type: 'numeric', units: 'm3/s', autosizable: true },
      { name: 'Maximum Sensible Heating Capacity', type: 'numeric', units: 'W', autosizable: true },
      { name: 'Cooling Limit', type: 'choice',
        choices: ['NoLimit', 'LimitFlowRate', 'LimitCapacity', 'LimitFlowRateAndCapacity'], default: 'NoLimit' },
      { name: 'Maximum Cooling Air Flow Rate', type: 'numeric', units: 'm3/s', autosizable: true },
      { name: 'Maximum Total Cooling Capacity', type: 'numeric', units: 'W', autosizable: true },
    ],
  },
  {
    name: 'Sizing:Zone',
    group: 'HVAC Design Objects',
    memo: 'Design conditions used to size zone equipment.',
    fields: [
      { name: 'Zone or ZoneList Name', type: 'object-list', references: ['Zone'], required: true },
      { name: 'Zone Cooling Design Supply Air Temperature Input Method', type: 'choice',
        choices: ['SupplyAirTemperature', 'TemperatureDifference'], default: 'SupplyAirTemperature' },
      { name: 'Zone Cooling Design Supply Air Temperature', type: 'numeric', units: 'C', default: '14' },
      { name: 'Zone Cooling Design Supply Air Temperature Difference', type: 'numeric', units: 'deltaC', default: '11.11' },
      { name: 'Zone Heating Design Supply Air Temperature Input Method', type: 'choice',
        choices: ['SupplyAirTemperature', 'TemperatureDifference'], default: 'SupplyAirTemperature' },
      { name: 'Zone Heating Design Supply Air Temperature', type: 'numeric', units: 'C', default: '40' },
      { name: 'Zone Heating Design Supply Air Temperature Difference', type: 'numeric', units: 'deltaC', default: '30' },
      { name: 'Zone Cooling Design Supply Air Humidity Ratio', type: 'numeric', units: 'kgWater/kgDryAir', default: '0.0085' },
      { name: 'Zone Heating Design Supply Air Humidity Ratio', type: 'numeric', units: 'kgWater/kgDryAir', default: '0.008' },
    ],
  },

  // --------------------------------------------------------------------- Output
  {
    name: 'Output:Variable',
    group: 'Output Reporting',
    memo: 'Requests a time-series output variable.',
    fields: [
      { name: 'Key Value', type: 'alpha', default: '*' },
      { name: 'Variable Name', type: 'alpha', required: true },
      { name: 'Reporting Frequency', type: 'choice',
        choices: ['Detailed', 'Timestep', 'Hourly', 'Daily', 'Monthly', 'RunPeriod', 'Environment', 'Annual'],
        default: 'Hourly' },
      { name: 'Schedule Name', type: 'object-list', references: ['Schedule:Compact', 'Schedule:Constant'] },
    ],
  },
  {
    name: 'Output:Meter',
    group: 'Output Reporting',
    memo: 'Requests an energy meter at the chosen frequency.',
    fields: [
      { name: 'Key Name', type: 'alpha', required: true },
      { name: 'Reporting Frequency', type: 'choice',
        choices: ['Detailed', 'Timestep', 'Hourly', 'Daily', 'Monthly', 'RunPeriod', 'Environment', 'Annual'],
        default: 'Monthly' },
    ],
  },
  {
    name: 'OutputControl:Table:Style',
    group: 'Output Reporting',
    memo: 'Format for the tabular summary reports.',
    fields: [
      { name: 'Column Separator', type: 'choice',
        choices: ['Comma', 'Tab', 'Fixed', 'HTML', 'XML', 'CommaAndHTML', 'TabAndHTML', 'XMLAndHTML', 'All'],
        default: 'HTML' },
      { name: 'Unit Conversion', type: 'choice',
        choices: ['None', 'JtoKWH', 'JtoMJ', 'JtoGJ', 'InchPound'], default: 'None' },
    ],
  },
  {
    name: 'Output:Table:SummaryReports',
    group: 'Output Reporting',
    memo: 'Selects which predefined summary reports are produced.',
    extensible: { size: 1, startIndex: 0 },
    fields: [{ name: 'Report 1 Name', type: 'alpha', default: 'AllSummary' }],
  },
];

const byLowerName = new Map<string, IddClass>(classes.map((entry) => [entry.name.toLowerCase(), entry]));

export function getClassSchema(className: string): IddClass | undefined {
  return byLowerName.get(className.toLowerCase());
}

export function allClasses(): IddClass[] {
  return classes;
}

export function allClassNames(): string[] {
  return classes.map((entry) => entry.name);
}

export function classesByGroup(): Map<string, IddClass[]> {
  const groups = new Map<string, IddClass[]>();
  for (const entry of classes) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return groups;
}

/**
 * Field metadata for an index, synthesising entries for extensible tails.
 * Surface vertices, for example, run past the last declared field.
 */
export function fieldAt(schema: IddClass, index: number): IddField | undefined {
  if (index < schema.fields.length) return schema.fields[index];
  const extensible = schema.extensible;
  if (!extensible) return undefined;

  const offset = index - extensible.startIndex;
  if (offset < 0) return undefined;

  const group = Math.floor(offset / extensible.size) + 1;
  const position = offset % extensible.size;

  if (extensible.size === 3) {
    const axis = ['X', 'Y', 'Z'][position];
    return { name: `Vertex ${group} ${axis}-coordinate`, type: 'numeric', units: 'm' };
  }
  const template = schema.fields[schema.fields.length - 1];
  return { name: `${template?.name ?? 'Field'} ${group}`, type: template?.type ?? 'alpha' };
}
