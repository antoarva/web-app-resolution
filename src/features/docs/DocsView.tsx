import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import * as Icons from 'lucide-react';
import { useSimulationStore } from '@/store/simulation-store';
import { Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Reference documentation.
 *
 * Content is authored as structured sections rather than raw HTML so it stays
 * searchable, and equations are typeset with KaTeX imported from the bundle —
 * loading it from a CDN would break offline use.
 */

interface DocBlock {
  kind: 'text' | 'math' | 'list' | 'code' | 'note';
  content: string;
  items?: string[];
  /** For `note` blocks. */
  tone?: 'info' | 'warning';
}

interface DocSection {
  id: string;
  title: string;
  icon: keyof typeof Icons;
  summary: string;
  blocks: DocBlock[];
}

const SECTIONS: DocSection[] = [
  {
    id: 'overview',
    title: 'What this app is',
    icon: 'BookOpen',
    summary: 'An offline editor and solver for EnergyPlus input files.',
    blocks: [
      { kind: 'text', content:
        'Envelop reads and writes EnergyPlus IDF files, shows the model as 3D geometry, and runs an '
        + 'annual thermal simulation — all in the browser, with no server involved. Once the page has '
        + 'loaded you can disconnect entirely and everything keeps working.' },
      { kind: 'text', content:
        'The compute-heavy parts run in WebAssembly: tokenizing the input file, deriving surface '
        + 'geometry, and solving the zone heat balance for every hour of the year. The interface is '
        + 'React; it never does numerical work itself.' },
      { kind: 'list', content: 'What runs where', items: [
        'WebAssembly — IDF tokenizer, polygon geometry kernel, annual heat-balance solver',
        'React + Three.js — 3D viewport, forms, charts, node graph',
        'IndexedDB — project storage on your device',
        'Service worker — precaches the app so it loads with no network',
      ] },
      { kind: 'note', tone: 'warning', content:
        'This is not EnergyPlus. It implements a simplified but physically grounded model, which is '
        + 'well suited to comparing design options early on. For results you intend to submit or '
        + 'certify, run the same IDF through EnergyPlus itself with a measured weather file.' },
    ],
  },
  {
    id: 'heat-balance',
    title: 'The zone heat balance',
    icon: 'Thermometer',
    summary: 'How zone temperature and HVAC load are computed each timestep.',
    blocks: [
      { kind: 'text', content:
        'Each thermal zone is modelled as a single well-mixed air node with a lumped heat capacity. '
        + 'That capacity covers the zone air plus the share of construction mass that actually '
        + 'participates on an hourly cycle. The rate of temperature change follows the net heat flow:' },
      { kind: 'math', content:
        'C \\frac{dT_z}{dt} = Q_{env} + Q_{sol} + Q_{int} + Q_{inf} + Q_{hvac}' },
      { kind: 'list', content: 'Each term', items: [
        'Q_env — conduction through every surface bounding the zone',
        'Q_sol — solar radiation transmitted through glazing',
        'Q_int — heat from people, lighting and equipment, scaled by the operating schedule',
        'Q_inf — outdoor air leaking in, carrying its temperature with it',
        'Q_hvac — whatever the system supplies to hold setpoint',
      ] },
      { kind: 'text', content:
        'The solver marches at sub-hourly timesteps for numerical stability, then reports hourly '
        + 'means. Zone capacitance combines air and construction mass:' },
      { kind: 'math', content:
        'C = V \\rho_{air} c_{p,air} + \\sum_i A_i \\kappa_i f_i' },
      { kind: 'text', content:
        'where the participation factor f is 1.0 for interior partitions, which exchange heat on both '
        + 'faces, and about 0.5 for exterior assemblies, whose outer layers are largely decoupled by '
        + 'the insulation.' },
    ],
  },
  {
    id: 'envelope',
    title: 'Envelope and solar gain',
    icon: 'Layers',
    summary: 'Conduction, sol-air temperature and transmitted solar.',
    blocks: [
      { kind: 'text', content:
        'Conduction through an opaque surface uses its whole-assembly U-value, which the app computes '
        + 'from the construction layer stack plus inside and outside surface films:' },
      { kind: 'math', content:
        'U = \\left( R_{si} + \\sum_j \\frac{d_j}{\\lambda_j} + R_{se} \\right)^{-1}' },
      { kind: 'text', content:
        'Absorbed solar radiation and longwave loss to the sky are folded into a sol-air temperature, '
        + 'so the surface can be treated as if it faced a warmer outdoor condition:' },
      { kind: 'math', content:
        'T_{sa} = T_{out} + \\frac{\\alpha \\, I_{inc}}{h_o} - \\frac{\\varepsilon \\, \\Delta R}{h_o}' },
      { kind: 'text', content:
        'The longwave term only applies to roofs, where the view of the sky is essentially '
        + 'unobstructed. Windows are handled separately: they conduct on their own U-value and '
        + 'transmit solar in proportion to their solar heat gain coefficient.' },
      { kind: 'math', content: 'Q_{sol} = \\mathrm{SHGC} \\cdot A_{win} \\cdot I_{inc}' },
      { kind: 'text', content:
        'Incident radiation on a tilted surface combines the beam component, an isotropic sky diffuse '
        + 'component weighted by the surface’s view of the sky, and ground-reflected radiation:' },
      { kind: 'math', content:
        'I_{inc} = I_b \\cos\\theta + I_d \\frac{1 + \\cos\\beta}{2} + I_g \\rho_g \\frac{1 - \\cos\\beta}{2}' },
    ],
  },
  {
    id: 'solar',
    title: 'Solar position',
    icon: 'Sun',
    summary: 'Where the sun is, computed from first principles.',
    blocks: [
      { kind: 'text', content:
        'Because the app cannot fetch a weather file offline, sun position is derived analytically '
        + 'from latitude, longitude and the day of year. Declination uses Cooper’s approximation:' },
      { kind: 'math', content:
        '\\delta = 23.45^\\circ \\sin\\left( \\frac{360 (284 + n)}{365} \\right)' },
      { kind: 'text', content:
        'Clock time is converted to true solar time using the longitude offset from the standard '
        + 'meridian and the equation of time. Solar altitude then follows:' },
      { kind: 'math', content:
        '\\sin\\alpha = \\sin\\phi \\sin\\delta + \\cos\\phi \\cos\\delta \\cos\\omega' },
      { kind: 'text', content:
        'Clear-sky irradiance comes from an air-mass attenuation model, scaled by a site clearness '
        + 'factor that stands in for average cloud cover. Air mass uses the Kasten-Young formula, '
        + 'which stays well behaved at low sun angles:' },
      { kind: 'math', content:
        'm = \\frac{1}{\\sin\\alpha + 0.50572 (\\alpha + 6.07995)^{-1.6364}}' },
    ],
  },
  {
    id: 'weather',
    title: 'Synthetic weather',
    icon: 'CloudSun',
    summary: 'How a plausible year is reconstructed from site statistics.',
    blocks: [
      { kind: 'text', content:
        'A normal EnergyPlus run reads an EPW file with 8760 measured hours. Running offline rules '
        + 'that out, so the engine rebuilds a year from a handful of climate normals: annual mean '
        + 'dry-bulb, the seasonal swing, the daily swing, mean sky clearness and ground temperature.' },
      { kind: 'math', content:
        'T_{out}(n, h) = \\bar{T} + A_a \\cos\\left(\\frac{2\\pi (n - n_{peak})}{365}\\right) '
        + '- A_d s(n) \\cos\\left(\\frac{2\\pi (h - 15)}{24}\\right)' },
      { kind: 'text', content:
        'The daily swing is scaled by s(n), which is widest in the warm season and compressed in '
        + 'winter — matching how clear summer days swing more than overcast winter ones. Below the '
        + 'equator the seasonal phase is shifted by half a year automatically.' },
      { kind: 'note', tone: 'info', content:
        'This gives realistic seasonal and diurnal behaviour, which is what matters when comparing '
        + 'two design options. It will not reproduce a specific historical year, and it has no '
        + 'weather extremes, so it is not a substitute for design-day sizing.' },
    ],
  },
  {
    id: 'controls',
    title: 'HVAC and controls',
    icon: 'Workflow',
    summary: 'Ideal loads, setback and optimum start.',
    blocks: [
      { kind: 'text', content:
        'The system is modelled as ideal loads: it supplies exactly the heating or cooling needed to '
        + 'hold setpoint, with no equipment, ducts or plant. Each timestep the solver first computes '
        + 'where the zone would drift with no conditioning, then supplies the difference:' },
      { kind: 'math', content:
        'Q_{hvac} = \\frac{C (T_{set} - T_z)}{\\Delta t} - Q_{free}' },
      { kind: 'text', content:
        'If the model declares a capacity limit, the supply is clipped to it and the timestep is '
        + 'counted as an unmet hour — which is what the results table reports.' },
      { kind: 'text', content:
        'Setpoints relax by 4 K in each direction when the zone is unoccupied. Rather than stepping '
        + 'instantly back at the start of occupancy, the controller ramps at 3 K/hour. Without that '
        + 'ramp, recovery draws an enormous single-timestep spike that makes peak loads meaningless.' },
    ],
  },
  {
    id: 'idf',
    title: 'Working with IDF files',
    icon: 'FileCode',
    summary: 'The file format and how the editor handles it.',
    blocks: [
      { kind: 'text', content:
        'An IDF file is a flat list of objects. Each begins with its class name, then comma-separated '
        + 'fields, terminated by a semicolon. Anything after an exclamation mark is a comment.' },
      { kind: 'code', content:
        'Zone,\n'
        + '  Perimeter_South,     !- Name\n'
        + '  0,                   !- Direction of Relative North {deg}\n'
        + '  0, 0, 0,             !- X, Y, Z Origin {m}\n'
        + '  1,                   !- Type\n'
        + '  1,                   !- Multiplier\n'
        + '  autocalculate,       !- Ceiling Height {m}\n'
        + '  autocalculate;       !- Volume {m3}' },
      { kind: 'text', content:
        'Objects reference each other by name: a surface names its zone and its construction, a '
        + 'construction names its material layers. The Objects view resolves those references into '
        + 'dropdowns, so you pick from what exists rather than retyping names.' },
      { kind: 'text', content:
        'The IDF text is the single source of truth in this app. Editing a field in a form rewrites '
        + 'the text; editing the text reparses the model. The two views can never drift apart.' },
      { kind: 'note', tone: 'info', content:
        'Field meanings come from a bundled subset of the EnergyPlus Input Data Dictionary. Classes '
        + 'outside that subset still load, save and round-trip correctly — they just show untyped '
        + 'text inputs instead of typed controls.' },
    ],
  },
  {
    id: 'geometry',
    title: 'Surface geometry',
    icon: 'Box',
    summary: 'How areas, orientations and volumes are derived.',
    blocks: [
      { kind: 'text', content:
        'Surfaces are arbitrary 3D polygons, so area and orientation both come from Newell’s '
        + 'method, which stays stable for non-convex and slightly non-planar rings alike:' },
      { kind: 'math', content:
        '\\mathbf{n} = \\sum_i \\begin{pmatrix} (y_i - y_j)(z_i + z_j) \\\\ '
        + '(z_i - z_j)(x_i + x_j) \\\\ (x_i - x_j)(y_i + y_j) \\end{pmatrix}, \\quad '
        + 'A = \\tfrac{1}{2} \\lVert \\mathbf{n} \\rVert' },
      { kind: 'text', content:
        'Tilt is the angle between the normal and vertical: 0° is a roof, 90° a wall, 180° a floor. '
        + 'Azimuth is measured clockwise from north, matching the EnergyPlus convention, and is what '
        + 'determines how much sun a facade receives.' },
      { kind: 'text', content:
        'Zone volume comes from the divergence theorem over the zone’s closed surface set, so it '
        + 'is correct for any shape, not just boxes:' },
      { kind: 'math', content:
        'V = \\left| \\frac{1}{3} \\sum_i (\\mathbf{c}_i \\cdot \\hat{\\mathbf{n}}_i) A_i \\right|' },
      { kind: 'note', tone: 'info', content:
        'Vertex order matters. The templates declare UpperLeftCorner, Counterclockwise, World in '
        + 'GlobalGeometryRules, and emit rings so that normals point outward. A reversed ring flips '
        + 'the normal, which sends a wall’s azimuth 180° the wrong way and ruins its solar gain.' },
    ],
  },
];

export function DocsView() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const engineVersion = useSimulationStore((state) => state.engineVersion);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return SECTIONS;
    return SECTIONS.filter((section) => {
      const haystack = [
        section.title, section.summary,
        ...section.blocks.map((block) => `${block.content} ${(block.items ?? []).join(' ')}`),
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [query]);

  const active = filtered.find((section) => section.id === activeId) ?? filtered[0] ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 border-b border-border p-2.5">
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.map((section) => {
            const Icon = Icons[section.icon] as Icons.LucideIcon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveId(section.id)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                  active?.id === section.id ? 'bg-accent' : 'hover:bg-accent/40',
                )}
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{section.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-[10px] text-muted-foreground">
                    {section.summary}
                  </span>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
        </nav>
        <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          Engine {engineVersion} · WebAssembly
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {active && (
          <article className="mx-auto max-w-3xl space-y-4 p-6">
            <header>
              <h1 className="text-xl font-semibold">{active.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{active.summary}</p>
            </header>
            {active.blocks.map((block, index) => <Block key={index} block={block} />)}
          </article>
        )}
      </div>
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.kind === 'math') return <MathBlock expression={block.content} />;

  if (block.kind === 'list') {
    return (
      <div>
        <h3 className="mb-1.5 text-sm font-medium">{block.content}</h3>
        <ul className="space-y-1">
          {(block.items ?? []).map((item, index) => (
            <li key={index} className="flex gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
        <code>{block.content}</code>
      </pre>
    );
  }

  if (block.kind === 'note') {
    const warning = block.tone === 'warning';
    return (
      <div className={cn(
        'rounded-md border p-3',
        warning ? 'border-warning/40 bg-warning/10' : 'border-info/40 bg-info/10',
      )}>
        <div className="flex items-start gap-2">
          {warning
            ? <Icons.AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            : <Icons.Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />}
          <p className="text-xs text-muted-foreground">{block.content}</p>
        </div>
      </div>
    );
  }

  return <p className="text-sm leading-relaxed text-muted-foreground">{block.content}</p>;
}

/** Renders one display equation with KaTeX. */
function MathBlock({ expression }: { expression: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    try {
      katex.render(expression, container, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [expression]);

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card px-3 py-3">
      <div ref={host} className="text-center" />
      {failed && <code className="text-xs text-muted-foreground">{expression}</code>}
    </div>
  );
}
