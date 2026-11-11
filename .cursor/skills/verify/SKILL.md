---
name: verify
description: Drive the Family Tree PWA in a browser and confirm the Families lens, the visibility lens, detail grants, divorce/remarriage, and branch ownership with fixture data at desktop and phone sizes. Use before shipping Visualize, the family sky, family-unit moves, the visibility lens, partner status, branch ownership, or a production deploy of familytree-rose.vercel.app.
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
8. Confirm Nia Fixture and Pal Fixture share a family, and that family is not Stu Fixture's. Nia's only parent on the tree is Stu, as a step-parent. Pal's parents are not on the tree. Wynn Fixture's only parent is Stu, as step, and Wynn has no partner: Wynn is a family of one, not a member of Stu's bucket. Zoom to Wynn and confirm the step link from Stu.
9. Move Rex Fixture (no partner, parent of Eli) into Dee's family and confirm Rex sits on Dee's row.
10. Reload and confirm the star positions match.

Before the Families checks, on the classic graph (Families lens off):

11. Tap Eli Fixture once. Relatives stay in the generation layout. No menu opens.
12. Focus Eli and press Shift+F10. The actions menu opens and nobody moves. Escape closes it and the layout stays.
13. Drag on Eli. The menu does not open and the layout does not gather. On phone, a touch drag does the same.
14. Press and hold Eli. The menu opens and nobody moves. Escape closes it and the layout stays.
15. Press and hold Eli again and choose Gather family. The graph becomes a personal map: Eli and Dee sit in the center as a couple, Fay below, Ada above, Cora on Eli's row, and Gran is dimmed farther out. Lines hide while the cards glide, then draw back in. A plain tap never gathers.
16. Tap empty space, then hold Eli, choose Gather family, and press Recenter. Both return the generation layout.
17. Tap Cora twice and confirm the editor still opens. The first of those taps does not gather.

Screenshots: `personal-map-<size>-before.png`, `personal-map-<size>-menu.png`, `personal-map-<size>-focused.png`, `personal-map-<size>-after.png`.

On the Families lens, after it is turned back on:

18. Zoom in on Eli Fixture and tap him once. Relatives stay in the sky layout (`data-layout="sky"`).
19. Focus Eli and press Shift+F10. The actions menu opens and nobody moves. Escape closes it. A drag does not open the menu or gather.
20. Press and hold Eli. The menu opens and nobody moves. Dismiss it. Hold again and choose Gather family. The sky becomes his personal map (`data-layout="personal"`): Dee beside him, Fay below, Ada above, Cora on his row, Gran dimmed. Lines hide during the glide, then draw back in. The script samples the selected card's transform while that glide runs, so a camera move alone does not count.
21. Tap empty space. The family-sky layout returns (`data-layout="sky"`).
22. Hold Eli, choose Gather family, then press All families (⌂). The sky layout returns.
23. Tap Cora twice and confirm the editor still opens. The first of those taps does not gather. Turning Families off still lands on the classic generation layout.

Screenshots: `family-sky-personal-<size>-menu.png`, `family-sky-personal-<size>-focused.png`, `family-sky-personal-<size>-after.png`.

After the reload check, still on the Families lens:

24. Zoom in close (`data-level="near"`) on Fay Fixture. Turn on Edit. Drag her horizontally along her row. She stays on that row, in Dee Fixture's family. IndexedDB stores her `rowNudge`. Reload, open Families again, and confirm she still sits at that nudged place.

25. Zoom in close (`data-level="near"`) on the curve from Ada Fixture to Eli Fixture. Before Edit, that curve is not an unlink target: tapping it does not ask, and the parent link stays in IndexedDB.
26. Turn on Edit. Tap that same curve. Confirm "Remove the parent link from Ada Fixture to Eli Fixture?". The curve disappears. IndexedDB no longer lists Ada as Eli's parent. Ben is still Eli's parent. Ada Fixture is still on the tree.
27. Zoom in on Nia Fixture and Pal Fixture. Tap their couple bar. The confirm says "Unlink Nia Fixture and Pal Fixture as partners?". Dismissing it leaves the union. Accepting it removes the union and leaves both people on the tree.

Screenshot: `family-sky-<size>-unlinked.png`.

Still on the Families lens, in the dark theme:

28. Turn Edit off if it is on. Open Lens. The sky is the owner's working view: every fixture person, details open.
29. Choose Eli Fixture. Touch Dee Fixture once (include), Fay Fixture twice (dim), and Rex Fixture three times (hide). A touch does not gather and does not open the editor. The layout stays `data-layout="sky"`.
30. Turn on Preview. The sky matches that view: Dee shown, Fay visually reduced (`is-lens-dim`, lower opacity, living details withheld), Rex gone. A tap while arranging does not open the hold menu and does not gather.
31. Return to arrange. Dee shows only her name and a generated avatar: no photo, no date. Press and hold Dee. The menu is Share details, off, and it does not offer Gather family. The sky stays `data-layout="sky"`. Turn Share details on. Dee stays included. Preview shows her fixture photo and the date 1800-01-01. Fay stays withheld: generated avatar, no photo, no date. Turn Share details off. Preview returns Dee to name and generated avatar only. The grant is gone from IndexedDB.
32. Choose the pending guest Quinn Fixture and preview. No one is on the sky.
33. Accept the invite. Only Eli Fixture and Dee Fixture are shown, details withheld. Fay is not, because the invite did not grant her.
34. Revoke the invite. The sky is empty again.
35. Choose You. The full fixture tree is back, details open, and Fay is not dimmed.
36. Reload. Eli's arranged lens and Quinn's revoked invite are still there. Dee's withdrawn detail grant stays off: no photo. The saved tree itself has no access field.

Screenshots: `lens-<size>-arrange.png`, `lens-<size>-preview.png`, `lens-<size>-share.png`, `lens-<size>-details.png`, `lens-<size>-guest-pending.png`, `lens-<size>-guest-accepted.png`, `lens-<size>-guest-revoked.png`, `lens-<size>-owner.png`.

After the lens checks, still on the Families lens, in the dark theme:

37. Turn Lens off. Open Dee Fixture. Set her couple with Eli Fixture to Divorced. Add a partner named Rema Fixture as Married.
38. The sheet says Dee is divorced from Eli and remarried to Rema. Remarried is derived. The saved union kind stays `married`, and the earlier union is `divorced`. The word `remarried` is not stored.
39. On the sky, Dee and Eli have a quiet dashed line. Tap it and the word Divorced appears. Dee and Rema have a double couple bar. Tap it and the word Remarried appears. Nobody new is invented except the partner just added, and that partner's name says Fixture.
40. Reload. Both facts are still there, and the sky still draws them.

Screenshot: `partner-status-<size>.png`.

Still on that tree, in the dark theme, at both sizes:

41. Turn Families off. Press and hold Eli Fixture on the classic graph. The menu includes Branch owner. Escape closes it and nobody moves. Turn Families back on.
42. Open Lens, still looking as you. Add an invite card named Lane Fixture. Hold Eli Fixture and give his branch to Lane Fixture. Eli, Dee, and Fay wear a small owner mark. Ada does not. The hand is in IndexedDB, and the saved tree itself still has no access field.
43. Look as Lane Fixture. Include Eli, Dee, Fay, Ada, and Ben, then accept the invite and preview. Eli, Dee, and Fay are editable. Ada and Ben are not.
44. Drag Dee Fixture along her row. The nudge is saved. Drag Ada Fixture the same way. Her place does not change. Tapping Ada and Ben's couple does not ask to unlink them. Tapping the line between Dee and Eli asks, and accepting it removes that union.
45. Take Eli's branch back. Preview as Lane again and drag Dee. Her place stays where the earlier nudge left it. The owner marks are gone.

Screenshots: `branch-owner-<size>-mark.png`, `branch-owner-<size>-preview.png`.

On a fresh pair of trees, still in the dark theme, at both sizes:

46. Import the Families fixture. Open Visualize, turn Families on, and open Lens as Eli Fixture. Include Eli and Dee, dim Fay, and hide Rex. Hold Dee, turn Share details on, then choose Share as file. The file is a download. It is not posted anywhere.
47. The file contains Eli, Dee, and Fay only. Fay has a name and no photo, date, or bio. Dee has the fixture photo and the date 1800-01-01. Eli's own fixture bio is open. Rex and Ada are absent.
48. In a second browser context, import the host fixture (Host Fixture only). Choose Add a shared family, pick the file, and read the preview: Ada Fixture as the owner, 3 people, and Eli, Dee, and Fay each with an avatar. Rex is not listed.
49. Add it. The sky shows that household as its own bucket, marked shared. Fay is a name and a generated avatar. Dee shows the fixture photo and 1800-01-01. Host Fixture is still a separate person.
50. Open Fay. The sheet says it is shared by Ada Fixture and read only. Link Fay to Host Fixture as partners. The two records stay themselves, and a partner line joins the buckets.
51. Import the same file again. The tree is still Host, Eli, Dee, and Fay, one shared family, and the partner link is still there.

Screenshots: `share-<size>-preview.png`, `share-<size>-linked.png`.

Screenshots, one set per size:

- `family-sky-<size>-links.png` — person-to-person links, none crossing an unrelated family
- `family-sky-<size>-buckets.png`
- `family-sky-<size>-stars.png`
- `family-sky-<size>-step.png` — Wynn Fixture alone in their bucket, with the step link from Stu Fixture
- `family-sky-<size>-zoomed.png`
- `family-sky-<size>-unit.png`
- `family-sky-<size>-row.png` — Rex on Dee's row, after the move
- `family-sky-<size>-placed.png` — Fay nudged along her row in Edit
- `family-sky-<size>-unlinked.png` — after Ada Fixture's link to Eli Fixture is removed in Edit
- `lens-<size>-arrange.png` — Eli Fixture's lens while Fay is dimmed and Rex is hidden but still touchable
- `lens-<size>-preview.png` — that same view with Rex gone and Fay dialed back
- `lens-<size>-share.png` — press-and-hold on Dee Fixture, Share details off
- `lens-<size>-details.png` — preview after the grant: Dee's fixture photo and date, Fay still withheld
- `lens-<size>-guest-pending.png` — Quinn Fixture's pending invite, nobody shown
- `lens-<size>-guest-accepted.png` — only Eli and Dee, the people the invite grants
- `lens-<size>-guest-revoked.png` — the invite cleared
- `lens-<size>-owner.png` — You, the full fixture tree again
- `partner-status-<size>.png` — Dee Fixture divorced from Eli Fixture and remarried to Rema Fixture, labels open
- `branch-owner-<size>-mark.png` — Eli Fixture's branch handed to Lane Fixture, with the owner mark on
- `branch-owner-<size>-preview.png` — previewing as Lane Fixture, Eli's branch editable and Ada locked
- `share-<size>-preview.png` — the import preview for Eli, Dee, and Fay Fixture
- `share-<size>-linked.png` — that shared family in the sky, linked to Host Fixture

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
