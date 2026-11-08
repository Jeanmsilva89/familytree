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

A **delegate** acts as the branch owner. They do not form a party of their own. A guest, and a person on another tree, cannot edit.

A relationship has no self claim for the child. When two line parents both may edit a child link, `standing` is empty until they agree or the tree owner decides. On the child's own record, the child stands when there is no tree owner, and `branchConflict` still reports the parents' tie.

## What a link exposes

`exposeLink` returns nothing for a pending or revoked link, even if a revoked link still carries its old grant. An accepted link with an empty grant also returns nothing.

A branch grant shows that branch. It skips a **sealed** person. Listing that person in the grant shows them. Unions and parent links are included only when every person they name is exposed, so a hidden parent is not leaked by the line.

Names travel with the grant. Living details (bio, dates, contact, photo) stay off. A person marked deceased has those details open. Nobody is deceased unless the access state says so. The model does not guess from dates.

## What a lens shows

A lens is data for one viewer: branch and person rules, each `include`, `hide`, or `dim`, plus optional detail grants. Person rules beat branch rules. Within one scope, the later rule wins.

`resolveVisibility` starts from nothing for a member. A rule cannot show a person who is outside the viewer's own tree and outside an accepted link aimed at them. A lens arranged for someone else is ignored. A sealed person on the home tree is skipped by a branch include and shown by a person include.

A guest starts from the accepted invite. A lens can hide or dim inside that set, and cannot add people the invite did not grant. Revoking the invite clears the set.

Living details stay withheld unless the viewer is that person, a detail grant names them, or they are deceased.

`ownerWorkingView` is the exception for the person who already holds the tree on their device: every person on that tree, details open, including sealed people. It does not include a linked tree. Anyone else gets an empty graph. A lens is how that owner decides what another viewer sees.

## Saved trees

`TreeData` is unchanged. `loadTree` and `parseTreeJson` do not add access fields. A backup written before this module loads with the same people, unions, child links, focus, and family-unit overrides.

## Next UI step

The next screen is a lens the owner arranges on the family sky, not a settings form. They choose a viewer — a person on the tree, or a guest named on an invite — and touch a branch or a person to include, hide, or dim them. An invite card moves from pending to accepted to revoked. This module is the data and the rules that screen will call. Accounts and a server come after that, not before.
