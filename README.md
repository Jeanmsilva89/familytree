# Family Tree

A free local-first PWA for starting a living family tree on a phone.
One name is enough. Stays on this device. No account.

Family Tree is a couple-centered living graph for modern families, not a pedigree from a dead ancestor.

On a phone the living tree is a pan-and-zoom generation graph: the household couple sits in the middle, older relatives above, children clustered under the couple that produced them.

## What it does

- Start with a single given name
- Add parent, partner, or child. Data persists in IndexedDB
- Installable PWA that works offline after first load
- Print the tree as a PDF from the browser
- Kid printables: relationship cards, match-the-lines, one puzzle
- Optional bio, important dates, and vCard download
- GEDCOM import and export

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
