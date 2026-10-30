# Pulse Arena F1 — implementation status

Last updated: 2026-10-30 (iteration 3).

This file replaces the "remaining work" list from iteration 1, which never reached the
repository (it is absent from every commit). It records what exists, what this iteration
restored, how it was verified, and what is still open.

## What iteration 3 found

Iteration 2 committed only *modified* files. Every file it *created* was lost, so `main`
did not build (`tsc` failed on 7 unresolved imports) and several finished features were
silently missing:

| Lost piece | Symptom on `main` | Status |
|---|---|---|
| `ui/bet/TicketDock.tsx` (sticky ticket, stake stepper/chips, swipe-to-confirm) | build error | rebuilt |
| `ui/bet/ResultCard.tsx` (in-play / locked / resolving / void / settled + proof) | build error | rebuilt |
| `ui/bet/motionBits.tsx` (odds ticker, count-up, spark burst) | build error | rebuilt |
| `three/engine/colliders.ts` (camera line-of-sight + scenery clearance) | build error | rebuilt |
| `three/track/ground.ts`, `three/track/site.ts` (procedural ground, baked night lighting) | build error | rebuilt |
| `ui/celebrate/*` (win moment, calm loss card, level-up/achievement unlocks) | build error; no win celebration | rebuilt |
| Daily check-in streak UI (store existed, no UI) | feature unreachable | rebuilt |
| Responsible-play reminder (setting existed, no UI) | feature unreachable | rebuilt |
| `pool2.*` and `scene3d.cam.*` dictionaries | raw keys on screen (e.g. `scene3d.cam.follow`) | rebuilt |
| `e2e/` Playwright suite (config referenced it) | no e2e coverage | rebuilt |

## Feature coverage (brief + mockups)

- **Shell**: Telegram SDK init, safe areas, back button, haptics, WebAudio SFX, RU/EN,
  onboarding, F1 nav bar with a car that launches/brakes between tabs, LIVE pulse button.
- **Screens**: Home, Races (season calendar + countdown), Meeting, Session, Live (3D broadcast,
  driver strip, camera dock, drag sheet with Pools / Timing / Feed / Mine), Pool (9 layouts:
  zone, duel, pit, tyre, pace, incident, position, quali, combo), Entry proof, My Pools,
  Profile, Leaderboard, Wallet, History, Rewards, Settings, Circuit, Driver.
- **Betting flow**: outcome tiles with live odds ticker and pool share, sticky ticket dock,
  stake stepper + chips, swipe-to-confirm (keyboard fallback), confirmation sheet
  (checking → stamped), in-play card, locked/resolving radar, void refund, settled result
  with bucket-rule visual, measured values and correction status, celebration overlay.
- **3D**: 24 circuits from real geometry, procedural F1 cars per team, Mercedes/Aston Martin
  safety and medical cars, start gantry lights, pit complex and crews, grandstands with
  crowd, landmarks, night lighting; follow / duel / TV / heli / onboard / front / side /
  orbit / overview cameras with collision-aware framing; 3D sector zones; SVG fallback on
  context loss (QA19).
- **Domain**: 21 market resolvers, lifecycle, settlement revisions, capability gating,
  ruleset 2026 Issue 09 — 518 unit tests.

## Also fixed in iteration 3

- Confirmation sheet rendered *under* the nav bar (trapped in the scrolling screen's stacking
  context) — now portaled to the app root, closes on Escape, respects the safe area.
- "ACCEPTED" stamp covered the balance-mode text — now straddles the ticket's tear line.
- Ticket dock was slightly translucent (outcome text ghosted through) — now opaque.
- Live pool chips truncated labels ("BOR…", "No p…") — label now sits above the odds.
- "Your pick" badge covered two-line tile titles; minor outcomes broke words mid-way
  ("Disqualifie-d") — tab on the tile edge, full-width minor rows; RU fits at 360 px.
- Archived pool showed a bare "No open pools" over the 3D layer — designed empty state with
  the user's entry and next actions; the scene is hidden.
- Races sticky header let list rows ghost through — opaque.
- Performance: the 3D engine (three.js + scene, ~900 KB) and secondary screens are lazy
  chunks prefetched at idle; entry chunk 991 KB → 443 KB (315 → 129 KB gzip).

## Verification (this iteration)

- `pnpm typecheck`, `pnpm build`, `pnpm test` — 541 unit tests green (incl. new collider,
  site-map, streak and active-time tests).
- `pnpm e2e` — 24/24 on 360×800 and 430×932: shell/navigation, onboarding, RU/EN switch,
  pick → stake → confirm (balance + entry), swipe threshold, QA17 (lock while open),
  QA19 (WebGL loss keeps pick + SVG map), QA20 RU/EN (no clipped anchor, CTA above nav,
  stable A/B duel order).
- Screenshot audits: `node dev/shot-app.mjs` (every route), `node dev/shot-dock.mjs`
  (betting flow), `node dev/shot-celebrate.mjs` (win/loss/streak/reminder).

## Still open / known limitations

- Verified in headless Chrome with software WebGL only; not yet smoke-tested inside a real
  Telegram client on a physical device.
- DEMO contour only: no live data adapter (OpenF1/FastF1) and no backend — out of scope
  for this frontend iteration by request.
- First live data after a cold start takes a few seconds while the DEMO session syncs;
  the Home "featured pool" skeleton is shown meanwhile.
