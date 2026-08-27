# Envelop

An offline, WebAssembly-powered editor and solver for EnergyPlus IDF files.

Everything runs in the browser. Once the page has loaded there is no server, no
API and no outbound request — disconnect the network and parsing, geometry,
simulation and storage all keep working.

## What it does

- **Reads and writes IDF files** — the EnergyPlus input format, tokenized in WebAssembly
- **3D geometry** — zones, surfaces, windows and shading, with click-to-inspect
- **Annual simulation** — hourly zone heat balance over 8760 hours, in ~150 ms
- **Results** — end-use breakdown, monthly energy, hourly time series, per-zone tables
- **Constructions** — layer stacks with computed U-values, R-values and thermal mass
- **Schedules** — Schedule:Compact expanded into daily profiles and an annual heatmap
- **HVAC** — the air path as an interactive node graph
- **Weather** — a built-in climate library with degree days and solar profiles

## Stack

| Layer | Choice |
|---|---|
| Build | Vite 5 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS with HSL design tokens (light/dark) |
| 3D | Three.js |
| State | Zustand |
| Text editor | Monaco, with a custom IDF language |
| Node graph | Rete 2 |
| Charts | Recharts |
| Math | KaTeX |
| Storage | IndexedDB via `idb` |
| Compute | **AssemblyScript → WebAssembly** |

## Why AssemblyScript

The compute core is written in AssemblyScript and compiled to a standalone
`.wasm` binary that is committed to the repo, so the app needs no toolchain at
runtime and no network at any point. AssemblyScript installs entirely from npm,
which means the WebAssembly build works on any machine that can run `npm
install` — no Emscripten, no LLVM wasm backend, no Rust toolchain.

The engine is ~24 KB and owns all the numerical work:

- **IDF tokenizer** — scans raw bytes, emits a flat object table
- **Geometry kernel** — Newell's method for area, normal, tilt and azimuth; divergence theorem for zone volume
- **Heat-balance solver** — sub-hourly integration of the zone energy balance across a full year

The React layer never does numerical work.

## Layout

```
app/
├── engine/                  # AssemblyScript source — everything compiled to WASM
│   ├── assembly/
│   │   ├── index.ts         # exported surface
│   │   ├── bytes.ts         # linear-memory transport
│   │   ├── idf/parser.ts    # IDF tokenizer
│   │   ├── geom/polygon.ts  # polygon kernel
│   │   └── sim/             # solar, weather, model, solver
│   └── asconfig.json
├── public/engine/           # compiled envelop.wasm (committed)
├── build/                   # service-worker generator plugin
└── src/
    ├── wasm/                # engine loader + binary protocol
    ├── core/                # domain logic, no UI
    │   ├── idf/             # parse, serialize, types
    │   ├── idd/             # field schema
    │   ├── model/           # building, constructions, climate, sim input
    │   └── templates/       # parametric starter models
    ├── store/               # zustand stores
    ├── features/            # one folder per view
    ├── components/ui/       # design-system primitives
    ├── app/                 # shell, navigation, error boundary
    ├── lib/                 # utils, persistence
    └── styles/              # tokens + global CSS
```

`src/wasm/protocol.ts` and `engine/assembly/sim/engine.ts` describe the same
binary layout from opposite sides. Field order is load-bearing — change one and
you must change the other.

## Running it

```bash
npm install
npm run dev      # compiles the WASM engine, then starts Vite
```

```bash
npm run build    # engine + typecheck + bundle
npm run preview  # serve the production build
```

`npm run engine:build` recompiles just the WebAssembly engine.

## Verifying it is genuinely offline

```bash
npm run build && npm run preview
# load http://localhost:4173, let the service worker precache (~84 entries)
# then stop the server and reload the page
```

The app loads and simulates with the server down.

## The model

A single well-mixed air node per zone with lumped capacitance:

```
C·dTz/dt = Q_envelope + Q_solar + Q_internal + Q_infiltration + Q_hvac
```

Conduction uses whole-assembly U-values from the layer stack plus surface
films. Absorbed solar and longwave sky loss fold into a sol-air temperature.
Windows transmit solar by SHGC. An ideal-loads system supplies exactly what is
needed to hold setpoint, with a 3 K/h optimum-start ramp so setback recovery
does not produce a meaningless single-timestep peak.

Weather is reconstructed analytically from site climate normals — a seasonal
sinusoid, a diurnal swing that widens in summer, and clear-sky irradiance from
real solar geometry. That is what allows a genuine annual simulation with no
EPW file to download.

**This is not EnergyPlus.** It is a simplified but physically grounded model,
well suited to comparing design options early. For results you intend to submit
or certify, run the same IDF through EnergyPlus with a measured weather file.
# web-app-resolution
