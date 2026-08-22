# Kinstart

A free local-first PWA for starting a living family tree on a phone.
One name is enough. Stays on this device. No account.

Kinstart is a couple-centered living graph for modern families, not a pedigree from a dead ancestor.

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

Names never leave the device. Kinstart stores the tree in the browser IndexedDB only. There is no signup, no server database, no analytics, and no third-party trackers.

## Local development

Install dependencies, start the Next.js dev server, and open http://localhost:3000
Run unit tests, then a production build before deploy.

## Deploy to Vercel

Import this GitHub repo in Vercel. Framework preset: Next.js. No custom domain needed.

## License

MIT
