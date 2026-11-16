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
Event Hubs and Blob Storage run as local emulators.

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

On the operations roster, **Camera & controls** opens a right-hand drawer for any
drone. The feed is a client-rendered Three.js scene, not streamed video or a sequence
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

Every resource is tagged so the dashboard's **Filters → Tags** can slice by kind
(`frontends`, `servers`, `simulators`, `infrastructure`) or by role (`customer`,
`operator`). Generated children such as `eventhubs-storage`, `storage-blobs` and the
npm installers are tagged explicitly because they don't inherit their parent's tags.
`WithTags` is an evaluation API in Aspire 17 (`ASPIRERESOURCETRAITS001`).

The development launch profile uses localhost HTTP endpoints; its unsecured
transport opt-in is local development configuration, not a deployment setting.

For separate frontend iteration, keep the API running and use either app:

```bash
cd customer-frontend
npm ci
npm run dev
# Or, from the template root:
cd operator-frontend
npm ci
npm run dev
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
Bag contents and map credentials remain in page memory. Backend orders
reset when the server restarts, with missing-order errors shown explicitly.

Each frontend publishes its `dist` into its own UI server's `wwwroot` using
`PublishWithContainerFiles`. The two ASP.NET servers have independent processes
and endpoints; neither contains logistics nor shares a static-file root.
Both frontends compile the common camera, pose buffer and map artwork from
`frontend-shared`; keep that directory beside the frontend source folders when
building. Published `dist` output is self-contained and needs no shared source
directory at runtime. The AppHost uses `frontend-shared/Dockerfile` with the template
root as its context and a per-site `FRONTEND` argument; this includes the shared
source without depending on the other site's packages. Its build-only `/app/dist`
artifact is still copied into the corresponding UI server's `wwwroot` by
`PublishWithContainerFiles`.
Both UI servers proxy to the service-discovered backend. This packaging is not an Azure
deployment claim; no deployment target is configured.

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
demand cycle. Fleet state lives in memory, so it resets when the simulator restarts.

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
and smoothly follows the simulator's camera orientation during take-off and landing. It has placeholder buildings,
not real video. A separately labelled last captured frame comes from the server's
blob-photo proxy, including proof of delivery when available.
The rendered camera uses OpenStreetMap tiles for the
ground, falling back to an illustrated map if they can't load. If WebGL is
unavailable, the overhead map still follows the drone.
Prices, battery levels and the company are fictional design data.
Plant milk choices are not an allergen-free guarantee; no dietary suitability is claimed.
This is not a navigation map or a flight planning tool.

## Checks

Run `npm test` (Vitest) and `npm run build` in both `customer-frontend` and `operator-frontend`.
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
its illustrated ground.

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
cd customer-frontend
npm ci
npm test
npm run build
cd ../operator-frontend
npm ci
npm test
npm run build
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

## Not ready yet

`aspire deploy` is **not configured in this design phase**. Real Azure deployment
and production identity/persistence are subsequent work.
Customer and operator clients already use the authoritative backend and scoped
SignalR updates. Do not treat this preview as meeting deployment acceptance criteria.

The [design](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/design.md) and
[architecture](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/architecture.md) notes in the repository
describe the proposed next steps. Those links refer to repository documentation,
not files generated into a new application.
