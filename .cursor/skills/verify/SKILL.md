---
name: verify
description: Drive the Family Tree PWA in a browser and confirm the Families lens with fixture data at desktop and phone sizes. Use before shipping Visualize, the family sky, family-unit moves, or a production deploy of familytree-rose.vercel.app.
---

# Verify the Families lens

Confirm the shipped Visualize behavior, not just that the page renders. Use the Playwright script. It loads a labeled fixture, then uses the same controls a person uses.

The fixture is `scripts/fixtures/verify-family-sky.json`. Every person is named Fixture. Do not put real relatives, dates, or family facts in that file or in screenshots you commit.

## What the script checks

At desktop (1280×800) and phone (390×844), in the dark theme:

1. Import the fixture through the backup JSON control.
2. Open Visualize.
3. Turn on the Families lens.
4. Zoom until family buckets and a blood link are on screen. No person-to-person link may cross the soft background of a family that neither endpoint belongs to.
5. Zoom out to the star view (`data-level="far"`) and confirm the "Tap a family to zoom in" hint.
6. Tap the Ada & Ben star and confirm the sky zooms back in.
7. Open Cora Fixture's person sheet and move her into Dee Fixture's family unit. The choice must stick in IndexedDB.
8. Confirm Nia Fixture and Pal Fixture share a family, and that family is not Stu Fixture's. Nia's only parent on the tree is Stu, as a step-parent. Pal's parents are not on the tree.
9. Move Rex Fixture (no partner, parent of Eli) into Dee's family and confirm Rex sits on Dee's row.
10. Reload and confirm the star positions match.

Before the Families checks, on the classic graph (Families lens off):

11. Tap Eli Fixture once. The graph becomes a personal map: Eli and Dee sit in the center as a couple, Fay below, Ada above, Cora on Eli's row, and Gran is dimmed farther out. The move glides.
12. Tap empty space, then select Eli again and press Recenter. Both return the generation layout.
13. Tap Cora twice and confirm the editor still opens.

Screenshots: `personal-map-<size>-before.png`, `personal-map-<size>-focused.png`, `personal-map-<size>-after.png`.

On the Families lens, after it is turned back on:

14. Zoom in on Eli Fixture and tap him once. The sky becomes his personal map (`data-layout="personal"`): Dee beside him, Fay below, Ada above, Cora on his row, Gran dimmed. The move glides (~480ms). The script samples the selected card's transform while that glide runs, so a camera move alone does not count.
15. Tap empty space. The family-sky layout returns (`data-layout="sky"`).
16. Tap Eli once more, then press All families (⌂). The sky layout returns.
17. Tap Cora twice and confirm the editor still opens. Turning Families off still lands on the classic generation layout.

Screenshots: `family-sky-personal-<size>-focused.png`, `family-sky-personal-<size>-after.png`.

After the reload check, still on the Families lens:

18. Zoom in close (`data-level="near"`) on the curve from Ada Fixture to Eli Fixture. Before Edit, that curve is not an unlink target: tapping it does not ask, and the parent link stays in IndexedDB.
19. Turn on Edit. Tap that same curve. Confirm "Remove the parent link from Ada Fixture to Eli Fixture?". The curve disappears. IndexedDB no longer lists Ada as Eli's parent. Ben is still Eli's parent. Ada Fixture is still on the tree.
20. Zoom in on Nia Fixture and Pal Fixture. Tap their couple bar. The confirm says "Unlink Nia Fixture and Pal Fixture as partners?". Dismissing it leaves the union. Accepting it removes the union and leaves both people on the tree.

Screenshot: `family-sky-<size>-unlinked.png`.

Screenshots, one set per size:

- `family-sky-<size>-links.png` — person-to-person links, none crossing an unrelated family
- `family-sky-<size>-buckets.png`
- `family-sky-<size>-stars.png`
- `family-sky-<size>-zoomed.png`
- `family-sky-<size>-unit.png`
- `family-sky-<size>-row.png` — Rex on Dee's row, after the move
- `family-sky-<size>-unlinked.png` — after Ada Fixture's link to Eli Fixture is removed in Edit

`<size>` is `desktop` or `phone`.

## Run it locally

```bash
npm install
npx playwright install chromium
npm run build
npm start
```

In another shell:

```bash
npm run verify
```

Screenshots land in `artifacts/verify` (gitignored). Override with `VERIFY_OUT`.

## Run it against a deployed app

```bash
VERIFY_BASE_URL=https://familytree-rose.vercel.app VERIFY_OUT=/opt/cursor/artifacts npm run verify
```

The site is a client-side PWA. A fresh browser context talks to the network for HTML, so this checks the deployment that is live now. Pass only when both sizes print `passed` and the script exits 0.
