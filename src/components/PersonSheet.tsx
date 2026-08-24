"use client";

import { FormEvent, useEffect, useId, useRef, useState, type ChangeEvent, type TouchEvent } from "react";
import type { ExtraField, KinKind, LinkRole, ParentRole, Person, TreeData, UnionKind } from "@/lib/types";
import {
  KIN_KIND_OPTIONS,
  PARENT_ROLE_OPTIONS,
  UNION_KIND_OPTIONS,
  cleanExtras,
  displayName,
  kinKindLabel,
  unionKindLabel,
} from "@/lib/types";
import { childrenOfPerson, kinBetween, parentRoleOf, parentsOf, unionsFor } from "@/lib/tree";
import { personToVCard, vcardFilename } from "@/lib/vcard";
import { NameAutocomplete } from "./AddNameRow";
import { scrollFieldIntoSheet, useBodyScrollLock } from "@/hooks/useVisualViewport";

type Rel = "parent" | "partner" | "child" | "sibling";

type Props = {
  tree: TreeData;
  person?: Person;
  onClose: () => void;
  onAddParent: (childId: string, name: string, role?: ParentRole, kin?: KinKind) => Promise<void>;
  onAddPartner: (personId: string, name: string, kind: UnionKind) => Promise<void>;
  onAddChild: (parentIds: string[], name: string, unionId?: string, kin?: Partial<Record<string, KinKind>>) => Promise<void>;
  onAddSibling: (personId: string, name: string) => Promise<string | void>;
  onLinkExisting: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind, parentRole?: ParentRole, kin?: KinKind) => Promise<void>;
  onSetUnionKind: (unionId: string, kind: UnionKind) => Promise<void>;
  onUpdateLink: (childId: string, parentId: string, patch: { role?: ParentRole | ""; kin?: KinKind }) => Promise<void>;
  onUnlink: (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) => Promise<void>;
  onDropUnion: (unionId: string) => Promise<void>;
  onEdit: (id: string, patch: Partial<Person>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

function downloadVCard(person: Person) {
  const blob = new Blob([personToVCard(person)], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = vcardFilename(person);
  a.click();
  URL.revokeObjectURL(url);
}

async function readSmallPhoto(file: File): Promise<string> {
  const raw = await file.arrayBuffer();
  if (raw.byteLength > 350_000) throw new Error("Choose a smaller photo.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}

export function PersonSheet({
  tree,
  person,
  onClose,
  onAddParent,
  onAddPartner,
  onAddChild,
  onAddSibling,
  onLinkExisting,
  onSetUnionKind,
  onUpdateLink,
  onUnlink,
  onDropUnion,
  onEdit,
  onRemove,
}: Props) {
  const titleId = useId();
  const [rel, setRel] = useState<Rel>("parent");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<UnionKind>("partnered");
  const [addRole, setAddRole] = useState<ParentRole | "">("");
  const [addKin, setAddKin] = useState<KinKind>("blood");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [bio, setBio] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otherLabel, setOtherLabel] = useState("");
  const [otherDate, setOtherDate] = useState("");
  const [extras, setExtras] = useState<ExtraField[]>([{ key: "", value: "" }]);
  const [hint, setHint] = useState<string | null>(null);
  const swipeStart = useRef<number | null>(null);
  useBodyScrollLock(Boolean(person));

  useEffect(() => {
    if (!person) return;
    setGivenName(person.givenName);
    setFamilyName(person.familyName ?? "");
    setBio(person.bio ?? "");
    setBirthDate(person.birthDate ?? "");
    setEmail(person.emails?.[0] ?? "");
    setPhone(person.phones?.[0] ?? "");
    setOtherLabel(person.otherDates?.[0]?.label ?? "");
    setOtherDate(person.otherDates?.[0]?.date ?? "");
    setExtras(person.extras?.length ? [...person.extras, { key: "", value: "" }] : [{ key: "", value: "" }]);
    setName("");
    setHint(null);
    setAddKin("blood");
    setAddRole("");
  }, [person]);

  function onSheetTouchStart(event: TouchEvent) {
    const sheet = event.currentTarget as HTMLElement;
    if ((event.target as HTMLElement).closest("input, textarea, select, button")) {
      swipeStart.current = null;
      return;
    }
    if (sheet.scrollTop > 8) {
      swipeStart.current = null;
      return;
    }
    swipeStart.current = event.touches[0]?.clientY ?? null;
  }

  function onSheetTouchEnd(event: TouchEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start == null) return;
    const dy = (event.changedTouches[0]?.clientY ?? start) - start;
    if (dy > 72) onClose();
  }

  if (!person) return null;

  const unions = unionsFor(tree, person.id);
  const parents = parentsOf(tree, person.id);
  const kids = childrenOfPerson(tree, person.id);
  const defaultParents =
    unions[0]?.partnerIds.filter((id) => tree.people.some((p) => p.id === id)) ?? [person.id];
  const hasParents = parents.length > 0;

  async function unlinkCouple(unionId: string, otherId: string | undefined, label: string) {
    if (!person) return;
    if (!confirm(`Unlink ${label} from ${displayName(person)}? Kids stay on the tree.`)) return;
    if (otherId) await onUnlink(person.id, otherId, "partner");
    else await onDropUnion(unionId);
  }

  async function unlinkParent(parent: Person) {
    if (!person) return;
    if (!confirm(`Remove ${displayName(parent)} as a parent of ${displayName(person)}?`)) return;
    await onUnlink(person.id, parent.id, "parent");
  }

  async function unlinkChild(child: Person) {
    if (!person) return;
    if (!confirm(`Remove ${displayName(person)} as a parent of ${displayName(child)}?`)) return;
    await onUnlink(person.id, child.id, "child");
  }

  async function saveNames() {
    if (!person) return;
    await onEdit(person.id, { givenName, familyName: familyName || undefined });
  }

  async function deletePerson() {
    if (!person) return;
    if (confirm(`Delete ${displayName(person)} from this tree?`)) {
      await onRemove(person.id);
      onClose();
    }
  }

  function childKinMap(): Partial<Record<string, KinKind>> | undefined {
    if (!person || addKin === "blood") return undefined;
    if (addKin === "adopted" || addKin === "foster") {
      return Object.fromEntries(defaultParents.map((id) => [id, addKin]));
    }
    return { [person.id]: addKin };
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !person) return;
    if (rel === "sibling" && !hasParents) {
      setHint("Add a parent first");
      return;
    }
    if (rel === "parent") await onAddParent(person.id, name, addRole || undefined, addKin);
    if (rel === "partner") await onAddPartner(person.id, name, kind);
    if (rel === "child") await onAddChild(defaultParents, name, unions[0]?.id, childKinMap());
    if (rel === "sibling") await onAddSibling(person.id, name);
    setName("");
    setHint(null);
  }

  async function pickExisting(other: Person) {
    if (!person) return;
    if (rel === "sibling" && !hasParents) {
      setHint("Add a parent first");
      return;
    }
    if (rel === "parent") await onLinkExisting(person.id, other.id, "parent", undefined, addRole || undefined, addKin);
    if (rel === "partner") await onLinkExisting(person.id, other.id, "partner", kind);
    if (rel === "child") await onLinkExisting(person.id, other.id, "child", undefined, undefined, addKin);
    if (rel === "sibling") await onLinkExisting(person.id, other.id, "sibling");
    setName("");
    setHint(null);
  }

  async function submitMore(event: FormEvent) {
    event.preventDefault();
    if (!person) return;
    await onEdit(person.id, {
      givenName,
      familyName: familyName || undefined,
      bio: bio || undefined,
      birthDate: birthDate || undefined,
      emails: email ? [email] : undefined,
      phones: phone ? [phone] : undefined,
      extras: cleanExtras(extras),
      otherDates:
        otherLabel && otherDate
          ? [{ id: person.otherDates?.[0]?.id ?? "d1", label: otherLabel, date: otherDate }]
          : undefined,
    });
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !person) return;
    try {
      const photo = await readSmallPhoto(file);
      await onEdit(person.id, { photo });
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Could not save photo.");
    }
  }

  const addLabel =
    rel === "parent" ? "Parent's name" : rel === "partner" ? "Partner's name" : rel === "sibling" ? "Sibling's name" : "Child's name";

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onSheetTouchStart}
        onTouchEnd={onSheetTouchEnd}
        onFocusCapture={(event) => scrollFieldIntoSheet(event.target)}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>{displayName(person)}</h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            Close
          </button>
        </div>
        {hint ? <p className="error">{hint}</p> : null}

        <form className="name-front" onSubmit={async (e) => { e.preventDefault(); await saveNames(); }}>
          <div className="field">
            <label htmlFor="front-given">Given name</label>
            <input id="front-given" value={givenName} onChange={(e) => setGivenName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="front-family">Family name</label>
            <input id="front-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          </div>
          <button className="btn" type="submit">Save name</button>
        </form>

        <section className="rel-block">
          <h3>Family</h3>
          {parents.length === 0 && unions.length === 0 && kids.length === 0 ? (
            <p className="hint">No links yet. Add someone below.</p>
          ) : null}
          {parents.map((parent) => {
            const role = parentRoleOf(tree, person.id, parent.id) ?? "";
            const kin = kinBetween(tree, person.id, parent.id);
            return (
              <article className="rel-row" key={`par-${parent.id}`}>
                <header>
                  <strong>{displayName(parent)}</strong>
                  <span>{role ? (role === "mother" ? "Mother" : "Father") : "Parent"} · {kinKindLabel(kin)}</span>
                </header>
                <div className="rel-fields">
                  <label>
                    Role
                    <select
                      value={role}
                      onChange={(e) => void onUpdateLink(person.id, parent.id, { role: e.target.value as ParentRole | "" })}
                    >
                      {PARENT_ROLE_OPTIONS.map((option) => (
                        <option key={option.label} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Related
                    <select
                      value={kin}
                      onChange={(e) => void onUpdateLink(person.id, parent.id, { kin: e.target.value as KinKind })}
                    >
                      {KIN_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="btn ghost danger-text" onClick={() => void unlinkParent(parent)}>
                  Unlink
                </button>
              </article>
            );
          })}
          {unions.map((u) => {
            const otherIds = u.partnerIds.filter((id) => id !== person.id);
            const others = otherIds
              .map((id) => tree.people.find((p) => p.id === id))
              .filter(Boolean) as Person[];
            const withNames = others.map(displayName).join(", ") || (otherIds.length ? "Unknown person" : "someone");
            return (
              <article className="rel-row" key={u.id}>
                <header>
                  <strong>{withNames}</strong>
                  <span>Partner · {unionKindLabel(u.kind)}</span>
                </header>
                <div className="rel-fields">
                  <label>
                    Couple
                    <select value={u.kind} onChange={(e) => onSetUnionKind(u.id, e.target.value as UnionKind)}>
                      {UNION_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="btn ghost danger-text" onClick={() => void unlinkCouple(u.id, otherIds[0], withNames)}>
                  Unlink
                </button>
              </article>
            );
          })}
          {kids.map((child) => {
            const kin = kinBetween(tree, child.id, person.id);
            return (
              <article className="rel-row" key={`kid-${child.id}`}>
                <header>
                  <strong>{displayName(child)}</strong>
                  <span>Child · {kinKindLabel(kin)}</span>
                </header>
                <div className="rel-fields">
                  <label>
                    Related
                    <select
                      value={kin}
                      onChange={(e) => void onUpdateLink(child.id, person.id, { kin: e.target.value as KinKind })}
                    >
                      {KIN_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="btn ghost danger-text" onClick={() => void unlinkChild(child)}>
                  Unlink
                </button>
              </article>
            );
          })}
        </section>

        <form className="rel-add" onSubmit={submitAdd}>
          <h3>Add someone</h3>
          <div className="seg" role="tablist" aria-label="Who to add">
            {(["parent", "partner", "child", "sibling"] as Rel[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={rel === item}
                className={rel === item ? "is-on" : undefined}
                onClick={() => { setRel(item); setHint(null); }}
              >
                {item === "parent" ? "Parent" : item === "partner" ? "Partner" : item === "sibling" ? "Sibling" : "Child"}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="rel-name">{addLabel}</label>
            <NameAutocomplete
              id="rel-name"
              label={addLabel}
              value={name}
              onChange={setName}
              people={tree.people}
              excludeId={person.id}
              onPick={pickExisting}
              required
            />
            <p className="hint">Type a new name, or pick someone already on the tree.</p>
          </div>
          {rel === "parent" ? (
            <div className="rel-fields">
              <label>
                Role
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as ParentRole | "")}>
                  {PARENT_ROLE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Related
                <select value={addKin} onChange={(e) => setAddKin(e.target.value as KinKind)}>
                  {KIN_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {rel === "partner" ? (
            <div className="field">
              <label htmlFor="union-kind">Couple type</label>
              <select id="union-kind" value={kind} onChange={(e) => setKind(e.target.value as UnionKind)}>
                {UNION_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          {rel === "child" ? (
            <div className="field">
              <label htmlFor="child-kin">Related to {person.givenName}</label>
              <select id="child-kin" value={addKin} onChange={(e) => setAddKin(e.target.value as KinKind)}>
                {KIN_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <button className="btn primary" type="submit">Add</button>
        </form>

        <details className="profile-fold">
          <summary>Profile details</summary>
          <form className="more" onSubmit={submitMore}>
            <div className="field">
              <label htmlFor="photo">Photo (optional, stays on this device)</label>
              <input id="photo" type="file" accept="image/*" onChange={onPhoto} />
            </div>
            <div className="field">
              <label htmlFor="birth">Birth date (optional)</label>
              <input id="birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="other-label">Another important date (optional)</label>
              <input id="other-label" placeholder="Label, e.g. moved in" value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} />
              <input aria-label="Important date" type="date" value={otherDate} onChange={(e) => setOtherDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="bio">A little bio (optional)</label>
              <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email">Email (optional)</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone (optional)</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <fieldset className="field extras-field">
              <legend>More facts (optional)</legend>
              <p className="hint">Anything beyond genealogy — occupation, nickname, a place you met.</p>
              {extras.map((item, index) => (
                <div className="extra-row" key={`ex-${index}`}>
                  <input
                    aria-label={`Fact ${index + 1} name`}
                    placeholder="Name"
                    value={item.key}
                    onChange={(e) => {
                      const next = extras.map((row, i) => (i === index ? { ...row, key: e.target.value } : row));
                      if (index === extras.length - 1 && e.target.value) next.push({ key: "", value: "" });
                      setExtras(next);
                    }}
                  />
                  <input
                    aria-label={`Fact ${index + 1} value`}
                    placeholder="Value"
                    value={item.value}
                    onChange={(e) => {
                      const next = extras.map((row, i) => (i === index ? { ...row, value: e.target.value } : row));
                      if (index === extras.length - 1 && e.target.value) next.push({ key: "", value: "" });
                      setExtras(next);
                    }}
                  />
                </div>
              ))}
            </fieldset>
            <div className="actions">
              <button className="btn primary" type="submit">Save details</button>
              <button className="btn" type="button" onClick={() => downloadVCard(person)}>Download vCard</button>
            </div>
          </form>
        </details>

        <button type="button" className="btn danger" onClick={() => void deletePerson()}>Delete</button>
      </div>
    </div>
  );
}
