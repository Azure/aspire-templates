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

1. The landing experience opens directly into the customer menu, with a clear
   **Barista & fleet** switch. This substitutes for demo sign-in during the spike;
   no real account is required.
2. Choose a single, double or quad payload first: one, two or four cup wells.
   Each coffee occupies one well; a biscuit takes ¼ and cake or croissant ½.
   These are illustrative packaging rules, not engineering constraints. A live
   tray shows occupancy, permits removal and coffee editing, and refuses overflow
   or downsizing below its contents. Unused capacity is allowed.
   Build coffee interactively by choosing style, size, milk, espresso shots,
   sugar and hot/iced temperature. The illustration, description and price update.
   Keep different recipes separate and merge identical recipes. Categories and
   search find coffees and treats; checkout permits quantity/recipe edits and
   shows AUD prices and full customization details before confirmation.
3. Confirm a demo order explicitly. The customer lands on a dedicated order
   status page (`#/order/<id>`) with a four-step progress indicator, ETA, items
   and total. A home-page card links back to it.
4. Once the order is ready, the status page adds two follow views: an overhead
   map centred on the assigned drone (illustrated, or Azure Maps when configured)
   and a simulated drone camera. The camera is a lazily loaded three.js scene: the
   ground plane is textured with the illustrated map, or Azure Maps road tiles
   when configured, with temporary placeholder buildings and trees to convey
   motion. It is labelled as a simulated feed, not real video. A reduced-motion
   preference removes bob and sub-second interpolation, and the page explains
   when WebGL is unavailable.
5. Offer a voice shortcut without making the menu less usable. The spike uses an
   editable example transcript; the UI explicitly says that it accesses no
   microphone and calls no AI.
6. Match only recognized menu items and quantities. A voice proposal replaces the
   bag only after the user chooses it, and placing the order still needs a
   separate confirmation. Unsupported modifiers, dietary requests, unknown
   products or ambiguous quantities ask for clarification.

The menu is five coffee styles plus a biscuit, cake and croissant. The company's
single-bar experience replaces the earlier multi-vendor direction. Do not add a
marketplace as a follow-up without a new scope decision. Plant-based milk is an
option, never an allergen-free guarantee.

## Vendor journey

The vendor portal presents a map and a live-feeling job queue together, with
compact fleet indicators. Ready orders expose **Request pickup**. The simulation
waits 30 seconds before automatic pickup so the reviewer can intervene.
Pause/resume and reset controls support reproducible design review.
The same browser-local order state is shared by the two views.

Six fictional drones are represented: four independent looping map markers and
two roster drones (FC-05/06). A customer-placed order is assigned one of the
roster drones, which waits on the coffee bar's pad while the order is ready and flies
a deterministic straight route to a fictional drop-off while delivering. The
other map paths are visual scaffolding. Actual dispatch, return-to-base and battery state
transitions are later work.

## Maps and voice feasibility

Azure Maps is the preferred provider to investigate. The integrated alternative
renders an actual basemap with fictional overlays using a reviewer-supplied,
short-lived Entra token. The default illustrated map needs no Azure account.
Live authentication, account policies and billing cannot be verified without
authorized account access. See the template README for the exact test path.

For voice, a future implementation should separate capture/transcription from
catalog-constrained interpretation. The customer owns the final confirmation.
Never retain raw audio by default or silently reinterpret allergy/dietary
requirements. An accessible text/manual flow must remain available.

## Immediate review criteria

- Both views are understandable and usable at desktop and mobile widths.
- A reviewer can select a payload, build customized coffees, fill spare capacity
  with treats, edit the contents, confirm it, and land on an order
  status page that follows the drone overhead and through a simulated camera.
- **Skip to next stage (demo)** lets a reviewer reach each stage without waiting.
- A vendor can request pickup before automatic dispatch.
- The scripted voice flow exposes its mock nature and never places an implicit
  order; unknown or modified requests stop for clarification.
- Illustrative versus Azure Maps data and the simulation's limitations are clear.

These are interaction checks, not proof of improved developer onboarding.
Later evaluation should use the entire eligible population of fresh-project
attempts during a named review window: record CLI/OS/prerequisites, generation
success, time to first usable local demo and deployment outcome, including
failures. There is no measured baseline yet. Establish it with the first
maintainer walkthrough and revisit after a real deployment; missing evidence is
pending, not success.

## Provisional architecture and follow-up

Keep the starter's C# AppHost + Minimal API + Vite/React arrangement. Mock service
data in the frontend until this direction is accepted. Next, prioritize shared
server-owned order/recipe/payload contracts, a deterministic simulator and
real-time delivery updates. Choose messaging/storage only when their demo value
justifies the added setup and cloud cost.

Open decisions for the owner: accept or adjust this visual direction; select the
hosted speech/AI capability and cost boundary; approve the Azure resource plan
before provisioning. No autonomous merges or paid-resource creation are granted.
