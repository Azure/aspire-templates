# Skylane design spike

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

Working brand: **Skylane — a little closer, by air.**

Use the Mornington waterfront and Main Street as the real geographic backdrop.
Restaurants, pickup sites, customers and delivery activity are fictional.
Soft ivory, forest green, muted coastal tones, generous space and original food/
drone illustrations make this a neighbourhood takeaway service rather than an
industrial flight-control console. No real business imagery or menu is copied.
The map is illustrative and cannot support navigation or real flight planning.

## Customer journey

1. The landing experience opens directly into the customer menu, with a clear
   **Kitchen & fleet** switch. This substitutes for demo sign-in during the spike;
   no real account is required.
2. Find an item through categories or search. Add items and adjust quantities in
   the bag. Show AUD pricing and the full total before confirmation.
3. Confirm a demo order explicitly. Show preparation, readiness for pickup,
   delivery and arrival in a tracking card.
4. Offer a voice shortcut without making the menu less usable. The spike uses an
   editable example transcript; the UI explicitly says that it accesses no
   microphone and calls no AI.
5. Match only recognized menu items and quantities. A voice proposal replaces the
   bag only after the user chooses it, and placing the order still needs a
   separate confirmation. Unsupported modifiers, dietary requests, unknown
   products or ambiguous quantities ask for clarification.

The initial menu groups four food styles under a fictional Peninsula Kitchen
collective to keep the spike small. Separate vendors and multiple store locations
remain a requirement for later implementation, not a completed capability.

## Vendor journey

The vendor portal presents a map and a live-feeling job queue together, with
compact fleet indicators. Ready orders expose **Request pickup**. The simulation
waits 30 seconds before automatic pickup so the reviewer can intervene.
Pause/resume and reset controls support reproducible design review.
The same browser-local order state is shared by the two views.

Six fictional drones are represented: four independent looping map markers and
two charging roster entries. The map paths are visual scaffolding, not
order-assigned routes. Actual dispatch, return-to-base and battery state
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
- A reviewer can add food, inspect/edit a bag, confirm it, and see order tracking.
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
server-owned order contracts, store locations, a deterministic simulator and
real-time delivery updates. Choose messaging/storage only when their demo value
justifies the added setup and cloud cost.

Open decisions for the owner: accept or adjust this visual direction; select the
hosted speech/AI capability and cost boundary; approve the Azure resource plan
before provisioning. No autonomous merges or paid-resource creation are granted.
