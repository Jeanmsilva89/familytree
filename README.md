# Family Tree

A free local-first PWA for starting a living family tree on a phone.
One name is enough. Stays on this device. No account.

Family Tree is a couple-centered living graph for modern families, not a pedigree from a dead ancestor.

On a phone (max-width 719px) Family Tree uses FocusFamily: one person at a time, parents above, partners beside them, children below, with large tap targets and no pinch-zoom canvas. On a wider screen the generation graph (TreeCanvas) stays the primary view.

## What it does

- Start with a single given name
- Add parent, partner, child, sibling, or someone unlinked, then connect them
- Link people already on the tree; edit couple type
- Family sky in Visualize: each family unit is a soft bucket around its people, with person-to-person links between buckets styled by relationship (blood, adopted, step, foster, partner). Zoom far out to see every family as a glowing star, tap one to zoom in, and zoom close for today's full cards. Units follow a maternal rule (daughters stay with their family; a husband joins his wife's). Blood and adopted parents place a child in that parent's bucket, then foster; a step link never does, so a step-only child keeps their own bucket. Any person can be moved to another unit from their sheet (their partner and children come along) or, in Edit, by dragging them into another family. Changes glide in while the other families keep their places. Toggle with the Families lens
- Household areas in the classic graph (Families lens off): each couple or single parent and the children still at home share one soft area, and a connector runs from parents to each grown child's own household (toggle with the Households lens)
- Optional local photo stored with the tree in IndexedDB
- Installable PWA that works offline after first load
- Print the tree as a PDF from the browser
- Kid printables: relationship cards, match-the-lines, one puzzle
- Optional bio, important dates, and vCard download
- GEDCOM import and export, plus a full JSON backup of the local tree

Empty-state art is a fictional example (Alex and Jordan, kids Sam and Riley). It is labeled and not loaded unless you tap Try example.

## Privacy

Names never leave the device. Family Tree stores the tree in the browser IndexedDB only. There is no signup, no server database, no analytics, and no third-party trackers. A GEDCOM or vCard file is created locally and only leaves the device if you choose to share that file.

## Local development

    npm install
    npm run dev

Open http://localhost:3000

    npm test
    npm run build

npm start serves the production build.

## Deploy to Vercel

1. In Vercel, Import the GitHub repo Jeanmsilva89/familytree.
2. Framework preset: Next.js. Build command npm run build.
3. No environment variables and no custom domain are required.
4. Deploy. The app is a client-side PWA; Vercel only hosts the app assets.

## License

MIT
