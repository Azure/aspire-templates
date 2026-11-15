# ForthCoffee: South Melbourne coffee by drone

**Design preview, not a complete delivery service.** Explore one fictional coffee
company in South Melbourne, Victoria: choose a payload, customize coffees and pack
treats, then follow a simulated drone. A barista dispatch queue and scripted
voice-ordering interaction share the same browser-local orders.
No real orders, payments, microphone recordings or drone flights occur.

## Run the design

Prerequisites: .NET SDK 10.0 or later, Node.js 22.13 or later, npm, and Aspire CLI.
No Azure account or container runtime is needed for the default illustrated map.

From this directory:

```bash
aspire run
```

Open the frontend endpoint from the Aspire dashboard. The AppHost starts a C#
Minimal API and the Vite/React frontend, using the same orchestration and
frontend-publishing pattern as Aspire's `aspire-ts-cs-starter`.
The development launch profile uses localhost HTTP endpoints; its unsecured
transport opt-in is local development configuration, not a deployment setting.

For frontend-only design iteration:

```bash
cd frontend
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Orders, the bag and map configuration
exist only in browser memory and reset on reload. Each browser has an independent
simulation. The minimal API's `/api/demo` and `/health` endpoints are available
when the server is running; the UX spike does not require the API for its mock
data.

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
   confirm a demo order. You land on its status page. Once it is ready, follow the drone on
   an overhead map and through a simulated drone camera. Use **Skip to next stage
   (demo)** to move on without waiting.
2. Switch to **Barista & fleet**. Coffee customizations appear on the docket.
   Request pickup for an order that is ready.
   Otherwise it dispatches automatically after 30 seconds; preparation takes
   20 seconds and simulated delivery another 35. New orders arrive every 45
   simulation seconds. Pause/resume or reset the scene.
3. Choose **Try a voice-order preview**. Edit “one latte and two biscuits”,
   match it to the menu, review the proposed payload, then separately confirm.
   Coffee defaults are regular, hot, double-shot with full cream milk (or no milk
   for espresso/long black). Edit cups with the builder afterward. Proposals must
   fit the chosen payload; they never silently resize it. The preview uses a
   small deterministic matcher, not speech recognition or an AI service.
   Unknown items, unsupported modifications and quantities outside 1–9 need
   clarification rather than silently changing the request.
4. Open **Map options** to investigate an Azure Maps basemap.

The four looping drone icons are illustrative and not assigned to orders. Your
own order is assigned FC-05 or FC-06, which flies a deterministic route from
ForthCoffee's fictional Coventry Street bar to an Albert Park drop-off. The drone camera is a three.js scene
with placeholder buildings, not real video. It uses Azure Maps road tiles for the
ground when Azure Maps is configured, otherwise the illustrated map. If WebGL is
unavailable, the overhead map still follows the drone.
Prices, battery levels and the company are fictional design data.
Plant milk choices are not an allergen-free guarantee; no dietary suitability is claimed.
This is not a navigation map or a flight planning tool.

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
and compiler caches. This design spike pins the available Aspire 13.6.5 packages.
Aspire CLI 17.0+ compatibility and repository-ref generation remain explicit final
milestone checks, not claims made by this spike.

## Validation

```bash
dotnet build DroneDelivery.AppHost
dotnet build DroneDelivery.Server
cd frontend
npm ci
npm test
npm run build
```

The tests cover payload capacity, variant identity/pricing, customization snapshots,
conservative transcript matching, confirmation-only order creation, invalid
configurations, the simulation lifecycle, the order's drone flight, South Melbourne
coordinate mapping and demo stage skipping. The Azure Maps SDK and three.js are loaded only when needed;
their large vendor chunks produce a Vite size advisory.

## Not ready yet

`aspire deploy` is **not configured in this design phase**. Real Azure deployment,
backend-owned orders/simulation, live updates, genuine
speech/AI integration and end-to-end template validation are subsequent work.
Do not treat this preview as meeting the epic's deployment acceptance criteria.

The [design](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/design.md) and
[architecture](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/architecture.md) notes in the repository
describe the proposed next steps. Those links refer to repository documentation,
not files generated into a new application.
