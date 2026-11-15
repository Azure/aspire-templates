# Skylane: Mornington drone delivery

**Design preview, not a complete delivery service.** Explore a fictional takeaway
experience over Mornington, Victoria: a customer menu and bag, a kitchen dispatch
queue, simulated drone movement, and a scripted voice-ordering interaction.
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

1. Browse or filter the menu, add items, review the bag, and explicitly confirm a
   demo order. Follow its progress in the customer view.
2. Switch to **Kitchen & fleet**. Request pickup for an order that is ready.
   Otherwise it dispatches automatically after 30 seconds; preparation takes
   20 seconds and simulated delivery another 35. New orders arrive every 45
   simulation seconds. Pause/resume or reset the scene.
3. Choose **Or, just say it**. Edit the example transcript, match it to the menu,
   review the proposed bag, then separately confirm the order. The preview uses a
   small deterministic matcher, not speech recognition or an AI service.
   Unknown items, unsupported modifications and quantities outside 1–9 need
   clarification rather than silently changing the request.
4. Open **Map options** to investigate an Azure Maps basemap.

The four moving drone icons follow independent illustrative loops; they are not
assigned to individual orders. Two additional drones are shown charging at base.
Prices, menu ratings, battery levels and all businesses are fictional design data.
This is not a navigation map or a flight planning tool.

## Azure Maps feasibility spike

The default original SVG map is approximate, credential-free and not sourced from
Azure Maps tiles. The alternative uses the Azure Maps Web SDK v3 and actual
Mornington geography with fictional store/drone markers.

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

Select **Mornington drone delivery (design preview)** if prompted. During review,
use the PR's head branch instead of `feature/drone-delivery`; the feature branch
does not contain these files until the PR is merged.

For a local template-engine smoke check from the repository root:

```bash
dotnet new install ./templates/aspire-drone-delivery
dotnet new aspire-drone-delivery --name MyMornington --output ./MyMornington
cd MyMornington
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

The tests cover conservative transcript matching, confirmation-only order
creation, invalid bags and the simulation lifecycle. The Azure Maps SDK is loaded
only when selected; its large vendor chunk produces a Vite size advisory.

## Not ready yet

`aspire deploy` is **not configured in this design phase**. Real Azure deployment,
backend-owned orders/simulation, multiple store locations, live updates, genuine
speech/AI integration and end-to-end template validation are subsequent work.
Do not treat this preview as meeting the epic's deployment acceptance criteria.

The [design](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/design.md) and
[architecture](https://github.com/Azure/aspire-templates/blob/feature/drone-delivery/docs/drone-delivery/architecture.md) notes in the repository
describe the proposed next steps. Those links refer to repository documentation,
not files generated into a new application.
