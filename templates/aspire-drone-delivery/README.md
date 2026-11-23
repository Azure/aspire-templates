# ForthCoffee: South Melbourne coffee by drone

**Design preview, not a complete delivery service.** Explore one fictional coffee
company in South Melbourne, Victoria: choose a payload, customize coffees and pack
treats, then follow a simulated drone. Two independent Vite/React sites share
server-owned orders and fleet telemetry: a customer-only coffee experience and
a fleet operations site.
No real orders, payments or drone flights occur.

## Run the design

Prerequisites: .NET SDK 10.0 or later, Node.js 22.13 or later, npm, Aspire CLI 17.0
or later and a container runtime such as Docker Desktop. No Azure account is needed:
Event Hubs, Blob Storage, Cosmos DB and SignalR run as local emulators.

From this directory:

```bash
aspire run
```

Open **customer-site** for ordering and your own tracking, or **operator-site**
for the store maps, dispatch queue and full fleet. There is no portal/login chooser
or operations UI on the customer site. While an order is Preparing, the customer
site shows a fictional barista profile (frontend-only mock data with illustrated
avatars), picked consistently from the order ID.

For presentations, a small **Skip** control beside the active stage fast-forwards
Preparing, Ready for pickup, or Delivering through the backend. Pickup skips include
the assigned drone's departure/charging wait, inbound flight and loading; delivery
skips include the flight and unloading. Queued orders still wait for preceding
missions, and pickup cannot be skipped before a drone is assigned. Commands travel
through the mission hub; telemetry and landing photos remain authoritative. Delivered
orders retain their proof-of-delivery frame instead of showing the return flight.

Click a drone marker on the operations map (or focus it and press Enter or Space)
to open its right-hand **Camera & controls** drawer. The roster offers the same
drawer and a case-insensitive name search, without filtering drones off the map.
The feed is a client-rendered Three.js scene, not streamed video or a sequence
of Blob images. Position, altitude, heading and camera pitch arrive over SignalR;
a two-second playout buffer interpolates only received poses (including heading
wraparound). Missing telemetry freezes the last pose and is labelled, never
extrapolated into another mission. Subtle scanlines and a rolling transmission band
are visual effects, disabled for reduced motion. Other drones use their real
reported positions and a small procedural model; no decorative flight paths are added.
The feed's airspace inset shows all current fleet positions with heading-aware
markers so aircraft outside the camera's field of view remain locatable.

The drawer sends commands through the backend and mission Event Hub:

| Command | Simulator effect |
| --- | --- |
| Emergency landing | Descend vertically at the current position; stay grounded and unavailable for dispatch |
| Return to base | Divert from the actual pose, land at the home pad and unload any package there |
| Discard package | Only available with a package; land at the designated waste drop-off, release there, then return to base |
| Reactivate | Only available when grounded; fly back to the home pad, unload if necessary and rejoin dispatch |

Commands are serialized per drone and acknowledged by telemetry. Interrupting a
mission marks its active order **unable to complete**, not Delivered; queued orders
are released for reassignment. Previously delivered orders stay delivered.
The waste point is fictional (`GET /api/waste`). All controls affect only the
simulator: this is not a real flight-control or collision-avoidance system.

**Take control** (drawer, airborne drones on a flight leg with no command pending)
floats the camera feed to the centre of the screen and suspends autonomous flight in
the simulator. Controls: **W/S** forward/back, **A/D** strafe, **Q/E** yaw,
**Space/Z** up/down, mouse over the feed to aim the camera (slightly above the horizon
to straight down, left/right), mouse **wheel** to zoom (1–8×), **Shift+wheel** to set
the focus distance and **F** to return to autofocus. The gimbal turns at up to 45°/s:
a dashed circle marks the requested aim and a solid circle the camera's actual aim.
Control starts from the drone's current camera aim, zoom and focus, so the pilot view
matches the operations feed. On release the camera returns to forward-facing, 1× and
autofocus. The header shows the live battery level. Roll and pitch bank automatically
and braking arrests momentum. A Web Audio synthesized motor sound plays while flying. **Esc** offers
*Resume previous programming* (replan from the current position) or *Cancel and
return to base* (the active order becomes unable to complete).

Inputs are posted to `POST /api/fleet/{id}/manual/input` at 10 Hz (and on key
change); `POST /api/fleet/{id}/manual` takes, resumes or returns to base. The
simulator owns the authoritative state and still enforces building clearance,
altitude limits and the service area. Telemetry is about 1 Hz, so the browser
predicts locally with the same model and reconciles. Released keys, window blur or
a hidden tab zero the input. If inputs stop for 1 s the drone hovers; after 30 s
without a link it resumes its previous programming. Take control needs a keyboard
and is not offered on the ground or during commands; reaching battery reserve
ends control and returns to base.

On the ground, drones retain their arrival heading; the next ascent turns by the
shortest arc toward the new leg. Airborne diversions start at the actual altitude
and blend their turn. The camera looks down during vertical flight, tilting forward
as the climb completes and down again as descent begins.

Blob capture remains independent: a bounded 64-frame upload queue snapshots the
pose at capture time. Slow storage does not stop telemetry; a full queue explicitly
logs a skipped capture. These remain labelled SVG placeholder images, not captures
of the browser's Three.js canvas or real photographs.

The AppHost starts:

| Resource | What it does |
| --- | --- |
| `eventhubs` | Event Hubs emulator with `orders`, `drone-missions`, `drone-telemetry` and `drone-photos` hubs |
| `storage` | Azurite with the `drone-photo-store` blob container for simulated camera images |
| `drone-simulator` | Worker that owns the fleet: flies missions, sends telemetry and uploads camera shots |
| `backend` | Authoritative REST APIs, logistics, Event Hubs ingestion, fleet/orders/photos and realtime publisher (`DroneDelivery.Server`) |
| `customer-server` | Customer UI host and service-discovered backend/negotiate proxy (`DroneDelivery.CustomerServer`) |
| `operator-server` | Operator UI host and service-discovered backend/negotiate proxy (`DroneDelivery.OperatorServer`) |
| `customer-simulator` | Worker that places orders from many customers at random South Melbourne locations |
| `customer-site` | Customer-only Vite/React app in `customer-frontend`, published into CustomerServer `wwwroot` |
| `operator-site` | Independent Vite/React app in `operator-frontend`, published into OperatorServer `wwwroot` |
| `signalr` | Azure SignalR Service local emulator, using Serverless mode |
| `cosmos` | Azure Cosmos DB (serverless when deployed; the Linux vNext emulator locally) with the `drone-delivery` database and `order-store` container |

Orders are written through to Cosmos DB once a second and reloaded when the backend
starts, so a backend restart keeps every order and in-flight mission. If the drone
simulator also restarted, a restored mission it no longer flies is re-dispatched, or
failed if the coffee was already aboard. The emulator serves HTTPS with the ASP.NET
developer certificate: on macOS, approve the keychain prompt the first time Aspire
exports it. Its data lives in the container, so it resets when the AppHost stops.
Serverless bills per request with no provisioned throughput, which suits a demo's low,
spiky traffic but offers no throughput guarantees or multi-region writes.

The UI servers reach the backend through `WithReference(backend)` and .NET service
discovery (`http://backend`), with no separate backend URL setting.

Every resource is tagged so the dashboard's **Filters → Tags** can slice by kind
(`frontends`, `servers`, `simulators`, `infrastructure`) or by role (`customer`,
`operator`). Tags are applied to the resources declared in `AppHost.cs`; children that
integrations add themselves, such as `eventhubs-storage` and the npm installers, are untagged.
`WithTags` is an evaluation API in Aspire 17 (`ASPIRERESOURCETRAITS001`).

The development launch profile uses localhost HTTP endpoints; its unsecured
transport opt-in is local development configuration, not a deployment setting.

For separate frontend iteration, keep the API running and install the shared npm
workspace from the template root. Start either app, or run both in separate terminals:

```bash
npm ci
npm run dev:customer
# In another terminal:
npm run dev:operator
```

Open each localhost URL printed by Vite. Both proxy `/api` and `/realtime` to
their own UI server, provided by Aspire (`SERVER_HTTPS` or `SERVER_HTTP`);
standalone Vite uses localhost ports 5383 (customer) and 5384 (operator).
Set `SERVER_HTTP` to the matching UI host's actual endpoint when running outside
Aspire. There is no browser-local order or fleet simulation.
The customer stores up to 20 order receipts in localStorage and subscribes only
to active orders among those IDs. A freshly accepted order may take up to 30 seconds
to appear through Event Hubs; the customer shows a confirming state before opening
its live connection. Delivered orders retain their final snapshot and close that
connection; failed and unserviceable orders also stop live subscriptions.
Reloading fetches the terminal snapshot without resubscribing.
Bag contents and map credentials remain in page memory. Backend orders are
reloaded from Cosmos DB when the server restarts.

Each frontend publishes its `dist` into its own UI server's `wwwroot` using
`PublishWithContainerFiles`. The two ASP.NET servers have independent processes
and endpoints; neither contains logistics nor shares a static-file root.
Both frontends compile the common camera, pose buffer and map artwork from
`frontend-shared`; keep that directory beside the frontend source folders when
building. Published `dist` output is self-contained and needs no shared source
directory at runtime. Both Vite resources use the template-root npm workspace as
their build context, with separate build scripts and output paths. Aspire's default
Vite image builder includes the shared source, and `PublishWithContainerFiles`
copies each output into its corresponding server. Both UI servers proxy to the
service-discovered backend. Declare frontend dependencies in the root
`package.json`: Aspire installs from the root manifests before copying the workspace
source into the build image.

This is not an authentication boundary: receipts filter the customer UI, but the
demo API is unauthenticated. Add authorization before exposing real customer data
or operations controls publicly.

## Simulated fleet and demand

The fleet has three drone classes, named after coffee serving sizes:

| Class | Payload bays | Cruise speed | Battery use |
| --- | --- | --- | --- |
| Piccolo | 1 | 16 m/s | 3% per km |
| Doppio | 2 | 14 m/s | 4.5% per km |
| Abbondante | 4 | 12 m/s | 7% per km |

At startup the drone simulator parks each drone on a random pad in the service
area with 35-100% charge. Drones only fly when they have a mission: they climb
and descend vertically (VTOL), return to their pad afterwards and charge while
parked. Telemetry is sent every second in flight and every 10 seconds on the pad.
Pickup and delivery progress uses the simulator's elapsed fraction of the complete
flight leg, including climb and descent, rather than horizontal distance alone.
Missing, stale or unrelated telemetry never advances a flight bar.
Horizontal travel accelerates and brakes at 2 m/s², using a triangular profile
for short hops. Drones brake to a hover at route bends and turn over three seconds
before accelerating again. Gentle deterministic turbulence changes pitch by up
to 1.6°, roll by 2° and yaw by 1.2°; the autopilot holds the planned position and
altitude. These attitudes are streamed, not independently invented by the browser.
Reduced-motion preferences suppress camera pitch/roll wobble.

The shared domain planner embeds the same bundled OSM building extract as the
camera. It checks whole route segments against conservative building bounding
boxes, with 6 m clearance. Drones skim rooftops: the altitude profile stays a few
metres above whatever lies under each part of the route (minimum 20 m en route), so
it rises over taller roofs and drops back afterwards. For tall buildings the planner
compares climbing over against detouring around, using an energy cost where each metre
of climb or descent counts as about 2.3 metres of level flight (from the drone's
battery rates). It picks the cheaper of the two. This is a heuristic search, not a
globally optimal 3D planner. For clearance only, missing heights
are conservatively treated as the renderer's 12 m estimation ceiling. Pickup
locations, home pads and drop-offs inside or very close to a footprint are rooftop
pads above its clearance envelope; buildings are no longer hidden around a drone.
Climbs and descents are limited to the drone's vertical-to-cruise speed ratio, and
legs never go above 120 m. Normal flights and
operator diversions use this same planner; emergency landing descends to the safe
pad altitude below the current position. Unsurveyed or blocked routes are refused
explicitly and reported in order notes or the operator drawer, without a
straight-line fallback.

Telemetry includes the actual planned waypoints and speed. Both overhead maps
draw that path, and the camera adds a translucent flight line and gates centred
on it. Dispatch time and battery estimates use the detour distance and eased
travel time. This is static building avoidance for a demo, not certified flight
planning: there is no drone-to-drone separation, moving-obstacle avoidance,
weather model or obstacle data beyond the bundled extract.
The camera captures a shot at the start and end of each takeoff and landing and
periodically in cruise; the landing at the customer is the proof-of-delivery shot.
Images are illustrated SVGs labelled as simulated, not real photos.

When an order arrives, the server's logistics worker picks the capable drone that
can deliver it soonest, preferring the smallest class. It accounts for battery
(with a 15% reserve and charging time), preparation time and drones already
committed to earlier missions, so with two Abbondante drones a third four-bay
order queues and gets a later estimate.

Tune the simulation with environment variables in `DroneDelivery.AppHost/AppHost.cs`:

| Variable | Worker | Default |
| --- | --- | --- |
| `FLEET_PICCOLO`, `FLEET_DOPPIO`, `FLEET_ABBONDANTE` | drone simulator | 6, 3, 2 |
| `FLEET_SEED` | drone simulator | random |
| `PARKED_TELEMETRY_SECONDS`, `CRUISE_PHOTO_SECONDS` | drone simulator | 10, 20 |
| `CUSTOMERS_PEAK` | customer simulator | 60 |
| `ORDERS_PER_CUSTOMER_PER_HOUR` | customer simulator | 3 |
| `DEMAND_CYCLE_MINUTES`, `DEMAND_QUIET_SHARE` | customer simulator | 15, 0.2 |
| `CUSTOMER_SEED` | customer simulator | random |

Active customers rise and fall between the quiet share and the peak over each
demand cycle. Fleet state lives in memory, so it resets when the simulator restarts;
orders persist in Cosmos DB.

The backend exposes `GET /api/fleet`, `GET /api/stores`, `GET /api/orders`,
`GET /api/orders/{id}`, `POST /api/orders` and
`GET /api/photos/{droneId}/{fileName}`. Single-order
responses include telemetry only when it belongs to that order and assigned drone.

## Realtime updates

Azure SignalR Service was selected instead of Web PubSub: they are different
protocols, not interchangeable clients. Aspire 17.0 supports
`AddAzureSignalR("signalr", AzureSignalRServiceMode.Serverless).RunAsEmulator()`.
The emulator supports **Serverless mode only**. No default-mode hub server is
hosted: the backend publishes through `Microsoft.Azure.SignalR.Management`
with transient transport, and the UI hosts expose their own negotiation routes.

The customer subscribes to the `customers` hub under its order ID and receives
only that order's snapshot. The operator subscribes to the separate `operators`
hub and receives fleet, stores and dispatch snapshots. Initial connection and
reconnect recover authoritative REST snapshots; realtime transport failures are
visible, with retries but no silent browser-polling substitute.
Customer order IDs are demo subscription identity, not authentication.
The backend retains at most 512 customer subscriptions, with one-hour leases
renewed on negotiation; expired subscriptions are removed rather than publishing
every historical order forever.

References: [Aspire SignalR integration](https://aspire.dev/integrations/cloud/azure/signalr/),
[emulator limitations](https://learn.microsoft.com/azure/azure-signalr/signalr-howto-emulator),
[Management SDK](https://learn.microsoft.com/azure/azure-signalr/signalr-howto-use-management-sdk).

## Tracing

Every .NET project calls `AddServiceDefaults()` from `DroneDelivery.ServiceDefaults`,
which exports OpenTelemetry traces, metrics and logs to the Aspire dashboard. The
app's own spans use the `DroneDelivery` activity source. One customer order is one
connected trace:

`customer place order` (browser) → customer-server proxy → backend `POST /api/orders`
→ `send orders` → `process orders` → `dispatch assign drone` → `send drone-missions`
→ drone-simulator `process drone-missions` → `drone await departure`,
`drone fly to pickup`, `drone load order`, `drone fly to customer`,
`drone unload order`, `drone return to pad` → `drone camera capture` with blob
uploads and `send drone-photos` → backend milestone processing →
`realtime publish order update`.

- Event Hubs messages carry W3C `traceparent`/`tracestate` in their application
  properties. The Event Hubs SDK's own spans are turned off so each send and
  receive appears once.
- Demo skips (`demo skip {stage}`) and customer-simulator orders start their own
  traces. Skips link to the order's trace.
- Spans carry only IDs, stages, payload sizes and counts. Customer names,
  coordinates, order contents, tokens and photo bytes are never recorded.
- Drone position ticks, operator snapshot broadcasts and other rootless HTTP calls,
  such as the SignalR management SDK's periodic requests, are not traced, so the
  dashboard isn't flooded. They are counted by the metrics below instead. Failed
  broadcasts still emit an error span, even when the order stage has not changed.

In the browser, both sites wrap user actions in spans (`customer place order`,
`customer skip stage`, `customer load order` and `operator load snapshot`). Fetch
instrumentation passes `traceparent` to the same-origin UI server. When the backend
publishes an order's stage change, the SignalR message carries that publish span's
`traceparent`, and the customer site records `customer receive order update` as a
child span when the message arrives. The trace therefore shows each stage reaching
the browser. Repeated per-second updates carry no trace context and add no spans.

Browsers can only export OTLP over HTTP, and the dashboard API key must stay out of
the browser:

- Under `aspire run`, the AppHost sets `WithOtlpExporter(OtlpProtocol.HttpProtobuf)`
  on the Vite apps. Each Vite dev server proxies `/otlp` to the dashboard and adds
  the key.
- A built site served by `customer-server` or `operator-server` asks its server for
  `/telemetry-config.json`. The server answers only when its own exporter uses
  `http/protobuf` (the AppHost sets this on both UI servers). It then relays
  `POST /otlp/v1/traces` to its OTLP endpoint with the `OTEL_EXPORTER_OTLP_HEADERS`
  added server-side. The relay accepts protobuf bodies up to 512 KB, does not
  trace its own requests, and returns `404` when it isn't configured.

## Metrics

The `DroneDelivery` meter covers the high-frequency work that is deliberately not
traced. Tags are limited to drone class, audience (`customer` or `operator`) and
outcome (`sent` or `failed`), never order or drone IDs:

| Instrument | What it measures |
|------------|------------------|
| `drone_delivery.telemetry.received` | Drone position readings applied by the backend |
| `drone_delivery.telemetry.age` | Seconds from a drone recording a position to the backend applying it |
| `drone_delivery.realtime.messages` | SignalR messages handed to the SignalR service |
| `drone_delivery.realtime.send.duration` | Seconds for the SignalR service to accept a message |
| `drone_delivery.realtime.customer_subscriptions` | Orders with a live customer subscription |

Tracing and metrics limits:

- The SignalR service or emulator, and its WebSocket delivery to the browser, can't
  be instrumented. The send metrics measure hand-off to the service. The browser
  receipt span covers stage changes only; per-second position pushes and operator
  snapshots are not recorded in the browser.
- The `/otlp` relay is an unauthenticated write path to the configured OTLP
  endpoint, like the Vite dev proxy. It suits the demo. A production deployment
  should relay to a collector that applies its own limits.
- Blob container creation shows a handled `409` from `CreateIfNotExists`.

## Things to try

1. Choose a **Single**, **Double** or **Quad** flight box (one, two or four
   bays), then tap a bay. Each bay holds exactly one coffee or one treat: use the
   **Coffee builder** tab to pick a coffee's style, size, milk, shots, sugar and
   temperature (the cup illustration and price update as you go), or the
   **Treats** tab for a biscuit, cake or croissant. Tap a filled bay to change it.
   These are illustrative packaging rules, not real payload engineering.
   The tray shows capacity and blocks overfilling or shrinking a box below its
   contents. You can leave space unused. Tap a packed coffee to edit it, or remove
   an item from the tray. Review quantities, options and AUD prices, then explicitly
   confirm a demo order. You land on its status page. Once it is ready and a drone
   is assigned, follow that drone's inbound flight to the bar on an overhead map
   and through a simulated drone camera. The order stays **Ready for pickup**
   until pickup, and both views carry on into delivery. A reserved drone serving
   another order, absent telemetry or a fix older than 30 seconds never produces
   an unrelated live view. Each order flies to a randomly chosen South Melbourne
   drop-off, which stays the same on the receipt, status page and map.
2. Open the separate **operator-site** endpoint. Coffee customizations appear
   on the docket alongside synthetic orders. Store locations, drone classes,
   battery levels, altitude, current work and queued missions come from the API.
   Logistics handles automatic pickup after preparation and drone arrival, including
   30 seconds for loading. Preparation takes 45 seconds plus 15 per payload bay;
   flight duration depends on distance and drone class. There are no browser
   skip/pickup/pause/reset controls that could contradict server state.
3. Both maps are OpenStreetMap basemaps with simulated drone positions on top.

Only API-reported drones appear in the operations map. Customer tracking uses the
assigned drone's actual simulator telemetry, with no browser-generated flight leg.
The three.js camera stays mounted through inbound flight, loading and delivery
and smoothly follows the simulator's camera orientation during take-off and landing. It renders
real OpenStreetMap building footprints, not real video. A separately labelled last captured frame comes from the server's
blob-photo proxy, including proof of delivery when available.
The rendered camera uses OpenStreetMap tiles for the
ground, falling back to an illustrated map if they can't load. If WebGL is
unavailable, the overhead map still follows the drone.
Prices, battery levels and the company are fictional design data.
Plant milk choices are not an allergen-free guarantee; no dietary suitability is claimed.
This is not a navigation map or a flight planning tool.

## Checks

Run the Vitest tests and build scripts for both npm workspaces.
Run `dotnet test DroneDelivery.Tests` and
`dotnet build DroneDelivery.AppHost/DroneDelivery.AppHost.csproj` from this directory.

## OpenStreetMap basemap

Both sites draw their overhead maps with [Leaflet](https://leafletjs.com) and
standard [OpenStreetMap](https://www.openstreetmap.org/copyright) raster tiles
from `tile.openstreetmap.org`, credited "© OpenStreetMap contributors". The
drone simulator's coordinates are real South Melbourne longitudes and latitudes;
the stores, drones and routes drawn on top are fictional. No account, key or
token is needed.

While a drone camera is open, the page also fetches the zoom-16 tiles that
cover the delivery corridor (at most 64, two at a time, once per page load) to
texture the simulated ground. If any tile fails, the camera says so and keeps
its illustrated ground. Zoom-16 tiles are about 2 m per pixel, so the ground
looks soft at low altitude; the extruded buildings carry the near-ground detail.

### Caching

Tiles are cached rather than refetched. The app never sends no-cache headers,
so the browser HTTP cache honours the tile server's `Cache-Control`/`ETag`.
Camera tiles also go through a per-page in-memory cache (`fetchTile` in
`frontend-shared/osm.ts`), and the composited camera ground is reused, so
switching drones or remounting the camera at pickup makes no new requests.
There is no prefetching beyond the tiles currently on screen.

### Camera buildings

`frontend-shared/osm-buildings.json` holds about 7,500 OpenStreetMap building
footprints for the camera area, © OpenStreetMap contributors, available under
the [ODbL](https://opendatacommons.org/licenses/odbl/). It was extracted once with
`node frontend-shared/scripts/fetch-osm-buildings.mjs` (a single Overpass query,
then simplified and delta-encoded; about 110 KB gzipped, lazily loaded). The app
never queries Overpass at runtime. Heights come from `height`, else
`building:levels` × 3.2 m. Untagged buildings take the height of the nearest
tagged building within about 170 m, capped at 12 m so a nearby tower doesn't
turn houses into towers, or 7 m when none is near. The simulator conservatively
uses the 12 m ceiling for untagged collision envelopes and treats pads inside
building envelopes as rooftop pads.

Each store has four landing pads, 9 m apart on one shared deck. The drone simulator
reserves a pad before a drone leaves for pickup, so no two drones hold the same pad. A
pad is released once its drone is 8 m clear. If every pad is taken, the drone waits,
charging on its home pad, until one frees up. Legs end with a curved approach: the
drone leaves its en-route altitude on a quarter-ellipse and touches down vertically on its
pad. The approach falls back to a straight vertical descent when the curve would clip
a building. The camera tunnel and both maps draw this same planned route, so they end
on the assigned pad.

The public OSM tile server is a volunteer-run service suitable for demos and
development traffic only. Its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
requires visible attribution and forbids bulk downloading or heavy use. Before
deploying this for real traffic, switch `osmTileUrl` in `frontend-shared/osm.ts`
to a commercial or self-hosted tile provider.

## Generate a project

The eventual acceptance path with a current Aspire CLI 17.0 or later is:

```bash
aspire new --template-repository https://github.com/azure/aspire-templates --template-repository-ref feature/drone-delivery
```

Select **forthcoffee-drones** if prompted. During review,
use the PR's head branch instead of `feature/drone-delivery`; the feature branch
does not contain these files until the PR is merged.

For a local template-engine smoke check from the repository root:

```bash
dotnet new install ./templates/aspire-drone-delivery
dotnet new forthcoffee-drones --name MyCoffeeRun --output ./MyCoffeeRun
cd MyCoffeeRun
aspire run
```

The generated tree excludes dependencies, build output, local environment files
and compiler caches. The template requires Aspire 17.0. Until Aspire 17.0.0 is on
nuget.org, the template's `NuGet.config` adds the Aspire release feed for `Aspire.*`
packages; remove that source once the packages are on nuget.org.

## Validation

```bash
dotnet build DroneDelivery.AppHost
dotnet test DroneDelivery.Tests
npm ci
npm test --workspace=forthcoffee-customer
npm run build:customer
npm test --workspace=forthcoffee-operations
npm run build:operator
```

The .NET tests cover VTOL flight legs, drone selection by payload, waiting and
charging before departure, queueing behind busy drones, unserviceable orders and
drones becoming available again. The frontend tests cover payload capacity, variant identity/pricing, customization snapshots,
confirmation-only order creation, invalid
configurations, the simulation lifecycle, the order's drone flight, South Melbourne
coordinate mapping, demo stage skipping and browser action spans. The .NET tests
also cover trace context crossing Event Hubs properties and keeping customer
details out of spans. three.js is loaded only when a camera opens; the
large vendor chunks produce a Vite size advisory.

## Azure Container Apps deployment

When created with `aspire new`, the template selects the highest eligible
`Aspire.Hosting.AppHost` version from enabled, package-source-mapping-eligible feeds
and uses it for all `Aspire.*` package references. Prereleases are eligible, but
must be at least the released `17.0.0` floor: `17.1.0-preview.*` qualifies;
`17.0.0-preview.*` does not. Selecting a template Git ref does not select a package
feed. `dotnet new` retains the `17.0.0` default unless `--AspirePackagesVersion` is
supplied. Unrelated package versions remain independent. Version selection alone
does not establish compatibility with every future Aspire release.

The AppHost targets Azure Container Apps. With an authenticated Azure CLI and an
appropriate subscription, resource group and region, run `aspire deploy` from the
template root. Aspire provisions the Container Apps environment and registry,
Cosmos DB serverless, Event Hubs, Storage and SignalR. These resources can incur
charges even when the demo is idle; the customer simulator also generates demand.

The backend and both simulators run as single replicas because they own in-memory
state or consume simulation events. They are not highly available, and events can
be missed during downtime. The two UI servers are public and unauthenticated; do
not expose this demo to untrusted users.

`aspire publish` generates infrastructure artifacts without deploying. A generated
project has been deployed to Azure Container Apps and checked with a customer order,
realtime updates and order recovery after a backend restart. Deployment still depends
on the subscription, region and available quotas.

The [design](docs/design.md) and [architecture](docs/architecture.md) notes
describe the proposed next steps.
