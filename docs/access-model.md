# Access model

Family Tree can already draw a complicated family. It cannot yet say who owns a branch, who is looking, or what a second tree is allowed to see. `src/lib/access` is that model: pure types and functions, with no screen, no network, and no account provider. Saved trees do not change. Access data lives beside `TreeData`, not inside it.

The fixture people in `src/lib/access/fixtures.ts` are labeled `FIXTURE`. They are not relatives.

## Who is looking

A viewer is one of two things.

- A **member** is a person on a tree.
- A **guest** is an outside relative named on an invite. They have no person record on that tree.

Ids for people, trees, invites, and lenses are branded so one cannot be passed where another is required. A link is a `pending` | `accepted` | `revoked` union. A pending link has no grant. An accepted link must have one.

## What a branch is

A branch is derived, not stored. `deriveBranch` starts at a person and keeps:

- that person
- descendants reached by a **blood**, **adopted**, or **foster** link
- partners of that person and of those descendants

A missing kin kind is blood, the same rule as the rest of the app. Every union counts, including a separated one, so a former partner stays in the branch. Parent role is ignored: two mothers, or two fathers, are symmetric.

Left out:

- **Step** links. A step-child stays in their own parent's branch. Remarriage does not move the child to the new spouse.
- Ancestors, siblings, and half-siblings. Half-siblings meet in the shared parent's branch, not in each other's.
- A partner's child who is not also a descendant of the root. That child belongs to the partner's branch.
- A co-parent with no union. Sharing a child link does not make two people partners.
- A parent who is not on the tree. An unknown parent is the absence of a person. No placeholder is created.

If someone can be reached by both a foster link and a blood or adopted link, the blood or adopted tie is kept.

## Who may edit

`resolveEdit` answers two questions: may this viewer write, and whose version stands when two branches overlap.

Claims, strongest first:

1. **Tree owner.** May edit anyone on their tree, and stands over every tie.
2. **Self.** On a person record, that person stands over other branch owners.
3. **Line.** Blood and adopted. These are equal, so a biological parent and an adoptive parent need agreement, and so do divorced parents and same-sex parents.
4. **Care.** Foster may edit, and loses a conflict to a line parent.
5. **Partner.** A partner may edit the partner's record, but self wins. A step-parent has no claim on the step-child. They may edit the step link they are named on, at partner rank, and a line parent still prevails.

A **delegate** acts as the branch owner. They do not form a party of their own. A guest, and a person on another tree, cannot edit through `resolveEdit`.

The tree owner can hand a branch to a guest named on a local invite. The hand is stored on the access state as `branchOwners`. It is not a kinship claim, and it does not change `resolveEdit`. `canEdit` is the gate for writing on this device:

- The tree owner may edit anyone on their tree, except a person, union, or parent link locked by an imported shared family.
- A guest may edit a person only when that person sits in a branch their invite holds. A relationship may be edited only when every person it names sits in such a branch.
- A pending or accepted invite can hold a branch. Revoking the invite removes those hands, the same way it clears that guest's detail grants. A revoked guest cannot edit.
- Taking the branch back removes the hand.
- Access saved before hands existed loads with no hands. `TreeData` still has no access field. A share file does not carry hands.

A relationship has no self claim for the child. When two line parents both may edit a child link, `standing` is empty until they agree or the tree owner decides. On the child's own record, the child stands when there is no tree owner, and `branchConflict` still reports the parents' tie.

## What a link exposes

`exposeLink` returns nothing for a pending or revoked link, even if a revoked link still carries its old grant. An accepted link with an empty grant also returns nothing.

A branch grant shows that branch. It skips a **sealed** person. Listing that person in the grant shows them. Unions and parent links are included only when every person they name is exposed, so a hidden parent is not leaked by the line.

Names travel with the grant. Living details (bio, dates, contact, photo) stay off. A person marked deceased has those details open. Nobody is deceased unless the access state says so. The model does not guess from dates.

## What a lens shows

A lens is data for one viewer: branch and person rules, each `include`, `hide`, or `dim`, plus optional detail grants. Person rules beat branch rules. Within one scope, the later rule wins.

`resolveVisibility` starts from nothing for a member. A rule cannot show a person who is outside the viewer's own tree and outside an accepted link aimed at them. A lens arranged for someone else is ignored. A sealed person on the home tree is skipped by a branch include and shown by a person include.

A guest starts from the accepted invite. A lens can hide or dim inside that set, and cannot add people the invite did not grant. Revoking the invite clears the set.

Living details stay withheld unless the viewer is that person, a detail grant names them, or they are deceased. A detail grant never adds a person. Someone outside the viewer's visible set stays off the graph, photo and dates included, even when a grant names them. Hiding or sealing them does the same. A dimmed person can still have details open.

A viewer always sees their own living details when they are shown. A person marked deceased stays open without a grant, including when dimmed. Withdrawing a grant does not close either of those.

Revoking an invite clears that guest's visible set, clears the detail grants stored on their lens, and ends any branch that guest was holding. A grant that is still sitting on the lens after a revoke, or a grant left on the revoked link, reveals nothing. Another viewer's grants stay where they are.

`ownerWorkingView` is the exception for the person who already holds the tree on their device: every person on that tree, details open, including sealed people. It does not include a linked tree. Anyone else gets an empty graph. A lens is how that owner decides what another viewer sees.

## Saved trees

`TreeData` is unchanged. `loadTree` and `parseTreeJson` do not add access fields. A backup written before this module loads with the same people, unions, child links, focus, and family-unit overrides.

## On the sky

The owner arranges a lens on the family sky, not in a settings form. They choose a viewer — a person on the tree, or a guest named on an invite — and touch a branch or a person to include, hide, or dim them. An invite card moves from pending to accepted to revoked.

Holding a person while arranging opens Share details. That toggles a detail grant for the viewer. It does not gather the sky and it does not open the editor. In the preview, a withheld person shows only their name and generated avatar. A granted person shows the photo and dates already stored for them. The same hold menu can save Share as file.

The hold menu, on the sky and on the classic graph, also offers Branch owner. The tree owner hands that person's branch to one of the local invite guests, or takes it back. Nothing is sent. While the lens or Edit is on, a person in a branch someone else holds wears a small ring and the guest's name. The default sky does not draw it. Previewing as that guest is the edit: people and relationships inside a branch they hold can be nudged, linked, and unlinked, and everything else stays as it is. An imported shared family stays read-only in that preview too.

## On Orbit

Orbit reads the same resolved view. While a lens preview is on, the scene is only the people `resolveVisibility` returned. A hidden person is not drawn, not dimmed, and not the end of a line. A hidden partner or parent does not keep an empty seat. A dimmed person stays dimmed, on the outer ring. Withheld living details are a name and a generated avatar; a photo is shown only when details are open. Everyone else shows their photo, or a generated avatar when they have none.

The owner ring shows on Orbit when the lens or Edit is on. Previewing as a guest, a drag along the generation row changes the place of a person in a branch that guest holds, and only that person. A second tap opens the editor for them. Anyone outside the branch stays where they are, and the editor does not open. An imported shared family stays read-only. Gather is still the press-and-hold. A tap does not gather.

## Share file

A share file is version 1 of `familytree-share`. Export runs `resolveVisibility` for the chosen viewer and writes only that graph. Hidden people are absent. A withheld living person keeps a name, and the screen draws a generated avatar from it. A detail grant, the viewer themselves, and a person marked deceased keep the details those rules already open. A parent link keeps its kin and role so the family still draws. The owner's name is on the file as provenance. Their living details are not, unless the viewer can see that person.

The file is built on the device. The share sheet or a download is the only way it leaves. Nothing uploads it.

Import rejects a file that is not this format, has no version, or uses a version this app does not read. The message says which. People are copied under new ids, remembered by the sender's person id. The same name and the same date do not merge anyone. Provenance — source tree, owner, and the time it was added — sits in the access state beside the tree. The sender owns that branch, so the importer cannot edit those people or the unions and parent links among them.

The two trees meet only when the importer links one imported person to one person already on their tree. That link uses the existing parent, partner, child, or sibling roles. The records stay two people, and the shared household stays in its own bucket. A newer file from the same tree and owner updates that family. People the new file leaves out are removed. Removing the shared family removes the imported people and the links that name them, and leaves the importer's own people in place.
