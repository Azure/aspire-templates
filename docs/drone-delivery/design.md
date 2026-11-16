# ForthCoffee design spike

Status: first direction for maintainer review. This is a working UX experiment
inside `templates/aspire-drone-delivery`, not a separate throwaway prototype.
Delivery target: `feature/drone-delivery`; all merges remain human-controlled.

## Outcome

Let a developer picture and interact with a coherent demo before choosing the
distributed-service design. The finished template must support repository/branch
generation on Aspire CLI 17.0+, `aspire run`, and a guided `aspire deploy`.
This first phase demonstrates the local interfaces; it does not complete the
epic or claim deployment readiness.

## Visual direction

Working brand: **ForthCoffee — great coffee. A little altitude.**

Use South Melbourne, Coventry Street and Albert Park as the geographic backdrop.
One fictional company, ForthCoffee, owns the menu, coffee bar and delivery
experience; this is not a restaurant marketplace. Customers and flights are fictional.
Soft ivory, forest green, warm coffee tones, generous space and original cup/
pastry illustrations make this a neighbourhood coffee experience rather than an
industrial flight-control console. No real business imagery or menu is copied.
The map is illustrative and cannot support navigation or real flight planning.

## Customer journey

1. The customer site opens directly into the menu. It contains no fleet operations,
   vendor switch or login chooser. Fleet operations is a separate Vite/React site
   and ASP.NET host with its own Aspire endpoint. Neither site has real authentication.
2. Choose a single, double or quad payload first: one, two or four bays. The
   landing page is the payload builder itself; tapping a bay opens a tabbed
   selector (coffee builder or treats) and each bay holds one coffee or one treat.
   These are illustrative packaging rules, not engineering constraints. A live
   tray shows occupancy, permits removal and coffee editing, and refuses overflow
   or downsizing below its contents. Unused capacity is allowed.
   Build coffee interactively by choosing style, size, milk, espresso shots,
   sugar and hot/iced temperature. The illustration, description and price update.
   Keep different recipes separate and merge identical recipes; checkout permits
   quantity/recipe edits and
   shows AUD prices and full customization details before confirmation.
3. Confirm a demo order explicitly. The customer lands on a dedicated order
   status page (`#/order/<id>`) with a four-step progress indicator, ETA, items
   and total. Its URL is the way back to it; the menu page lists no past orders.
4. Once the order is ready and matching assigned-drone telemetry is available,
   the status page adds two follow views: an overhead
   OpenStreetMap view centred on the assigned drone
   and a simulated drone camera. The camera is a lazily loaded three.js scene: the
   ground plane is textured with OpenStreetMap tiles (or an illustrated map if
   they can't load), with temporary placeholder buildings and trees to convey
   motion. It is labelled as a simulated feed, not real video. A reduced-motion
   preference removes bob and sub-second interpolation, and the page explains
   when WebGL is unavailable. The inbound leg targets the pickup store, while the
   order remains Ready for pickup. The same views continue through loading into
   delivery. Queued assignments, unrelated missions and stale fixes never become
   a misleading live view. The last captured backend frame is labelled separately.

The menu is five coffee styles plus a biscuit, cake and croissant. The company's
single-bar experience replaces the earlier multi-vendor direction. Do not add a
marketplace as a follow-up without a new scope decision. Plant-based milk is an
option, never an allergen-free guarantee.

## Fleet operations journey

The independent operations site presents the store map and dispatch queue together,
with a roster of every API-reported drone. Both sites use the same server-owned
orders and fleet; there is no browser-local simulation or portal switch.
Each site has its own frontend folder, UI server and published assets. Azure
SignalR Serverless delivers updates from the backend through its local emulator:
customer connections receive only their order snapshots, while operator
connections receive fleet/dispatch snapshots. REST restores initial and reconnect
state; the clients do not substitute polling for realtime delivery.
Logistics handles scheduling and pickup after preparation, arrival and loading.
Battery, drone class, altitude, current order and queued missions are reported
telemetry, not decorative constants. Browser skip, pickup and reset controls are
removed because they would contradict the server-owned lifecycle.

## Maps

Maps use OpenStreetMap tiles through Leaflet with fictional overlays. No account
or token is needed. The public tile server is for demo and development traffic;
see the template README for the tile usage policy and how to swap providers.

## Immediate review criteria

- Both views are understandable and usable at desktop and mobile widths.
- A reviewer can select a payload, build customized coffees, fill spare capacity
  with treats, edit the contents, confirm it, and land on an order
  status page that follows the drone overhead and through a simulated camera.
- Customer ordering appears in the independent operations queue via the shared API.
- Ready orders follow only their assigned inbound mission and retain the camera
  through pickup and delivery.
- OpenStreetMap attribution and the simulation's limitations are clear.

These are interaction checks, not proof of improved developer onboarding.
Later evaluation should use the entire eligible population of fresh-project
attempts during a named review window: record CLI/OS/prerequisites, generation
success, time to first usable local demo and deployment outcome, including
failures. There is no measured baseline yet. Establish it with the first
maintainer walkthrough and revisit after a real deployment; missing evidence is
pending, not success.

## Provisional architecture and follow-up

Keep the C# AppHost + Minimal API + two Vite/React sites. Both sites use the API.
Next, prioritize shared
server-owned order/recipe/payload contracts, a deterministic simulator and
real-time delivery updates. Choose messaging/storage only when their demo value
justifies the added setup and cloud cost.

Open decisions for the owner: accept or adjust this visual direction; approve the Azure resource plan
before provisioning. No autonomous merges or paid-resource creation are granted.
