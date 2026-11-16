# ForthCoffee: South Melbourne coffee by drone

**Design preview, not a complete delivery service.** Explore one fictional coffee
company in South Melbourne, Victoria: choose a payload, customize coffees and pack
treats, then follow a simulated drone. Two independent Vite/React sites share
server-owned orders and fleet telemetry: a customer-only coffee experience and
a fleet operations site. The voice-ordering shortcut is scripted.
No real orders, payments, microphone recordings or drone flights occur.

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
connection; reloading fetches the completed snapshot without resubscribing.
Bag contents and map credentials remain in page memory. Backend orders
reset when the server restarts, with missing-order errors shown explicitly.

Each frontend publishes its `dist` into its own UI server's `wwwroot` using
`PublishWithContainerFiles`. The two ASP.NET servers have independent processes
and endpoints; neither contains logistics nor shares a static-file root.
Frontend builds are self-contained, including map artwork and theme assets,
so their publish contexts need no sibling source directories.
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
3. Choose **Try a voice-order preview**. Edit “one latte and two biscuits”,
   match it to the menu, review the proposed payload, then separately confirm.
   Coffee defaults are regular, hot, double-shot with full cream milk (or no milk
   for espresso/long black). Edit cups with the builder afterward. Proposals must
   fit the chosen payload; they never silently resize it. The preview uses a
   small deterministic matcher, not speech recognition or an AI service.
   Unknown items, unsupported modifications and quantities outside 1–9 need
   clarification rather than silently changing the request.
4. Open **Map options** to investigate an Azure Maps basemap.

Only API-reported drones appear in the operations map. Customer tracking uses the
assigned drone's actual simulator telemetry, with no browser-generated flight leg.
The three.js camera stays mounted through inbound flight, loading and delivery
and points straight down during take-off and landing. It has placeholder buildings,
not real video. A separately labelled last captured frame comes from the server's
blob-photo proxy, including proof of delivery when available.
The rendered camera uses Azure Maps road tiles for the
ground when Azure Maps is configured, otherwise the illustrated map. If WebGL is
unavailable, the overhead map still follows the drone.
Prices, battery levels and the company are fictional design data.
Plant milk choices are not an allergen-free guarantee; no dietary suitability is claimed.
This is not a navigation map or a flight planning tool.

## Checks

Run `npm test` (Vitest) and `npm run build` in both `customer-frontend` and `operator-frontend`.
Run `dotnet test DroneDelivery.Tests` and
`dotnet build DroneDelivery.AppHost/DroneDelivery.AppHost.csproj` from this directory.

## Azure Maps feasibility spike

The default original SVG map is approximate, credential-free and not sourced from
Azure Maps tiles. The alternative uses the Azure Maps Web SDK v3 and actual
South Melbourne geography with fictional coffee-bar/drone markers.

To try it, use an **existing** Azure Maps account and an identity with **Azure
Maps Data Reader** access to that account:

1. Obtain the account's **client ID** from its Azure portal authentication page
   (this is not an Entra application registration ID).
2. With the Azure CLI authenticated as that identity, obtain a short-lived access
   token for `https://atlas.microsoft.com/`. For example:
   ```bash
   az account get-access-token --resource https://atlas.microsoft.com/ --query accessToken -o tsv
   ```
   Treat the output as a credential. Paste it only into the local preview's
   password field, never an issue, PR, screenshot or committed file.
3. Enter both values in **Map options** and choose **Explore Azure Maps**.
   The token is retained only in page memory, sent to Azure Maps by its SDK,
   and is not stored by the sample server. Reload or switch to the illustrated
   map to clear it. There is no automatic token renewal in this spike.
   While an order's drone camera is open, the page also requests up to 64
   zoom-16 road tiles directly from `atlas.microsoft.com` with the same token to
   texture the simulated ground. If any tile fails, the camera says so and falls
   back to the illustrated ground.

The account must be reachable from the browser and its policies must allow the
requested access. Token/account/network failures appear on the map rather than
being reported as success. Switching back to the illustrated map is explicit.
No resource is provisioned by this UI; **using your existing account may incur
Azure Maps charges**. See the [pricing page](https://azure.microsoft.com/pricing/details/azure-maps/).

The production direction is a backend token endpoint using managed identity and
least-privilege RBAC, not a long-lived account key in Vite configuration. A public
token endpoint needs its own abuse/rate controls even without real demo identity.
See the [authentication guidance](https://learn.microsoft.com/azure/azure-maps/azure-maps-authentication).
Live basemap access has not been validated without an authorized Azure Maps
account. SDK integration and UI feasibility are not proof of working Azure access.

## Generate a project

The eventual acceptance path with a current Aspire CLI 17.0 or later is:

```bash
aspire new --template-repository https://github.com/azure/aspire-templates --template-repository-ref feature/drone-delivery
```

Select **ForthCoffee drone delivery (design preview)** if prompted. During review,
use the PR's head branch instead of `feature/drone-delivery`; the feature branch
does not contain these files until the PR is merged.

For a local template-engine smoke check from the repository root:

```bash
dotnet new install ./templates/aspire-drone-delivery
dotnet new aspire-drone-delivery --name MyCoffeeRun --output ./MyCoffeeRun
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
conservative transcript matching, confirmation-only order creation, invalid
configurations, the simulation lifecycle, the order's drone flight, South Melbourne
coordinate mapping and demo stage skipping. The Azure Maps SDK and three.js are loaded only when needed;
their large vendor chunks produce a Vite size advisory.

## Not ready yet

`aspire deploy` is **not configured in this design phase**. Real Azure deployment,
genuine speech/AI integration and production identity/persistence are subsequent work.
Customer and operator clients already use the authoritative backend and scoped
SignalR updates. Do not treat this preview as meeting deployment acceptance criteria.

The [design](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/design.md) and
[architecture](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/architecture.md) notes in the repository
describe the proposed next steps. Those links refer to repository documentation,
not files generated into a new application.
