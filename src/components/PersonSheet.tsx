"use client";

import { FormEvent, useEffect, useId, useRef, useState, type ChangeEvent, type TouchEvent } from "react";
import type { LinkRole, Person, TreeData, UnionKind } from "@/lib/types";
import { displayName } from "@/lib/types";
import { parentsOf, unionsFor } from "@/lib/tree";
import { personToVCard, vcardFilename } from "@/lib/vcard";
import { PeopleList } from "./PeopleList";

type Mode = "closed" | "actions" | "add" | "more" | "link";
type Rel = "parent" | "partner" | "child" | "sibling";

type Props = {
  tree: TreeData;
  person?: Person;
  onClose: () => void;
  onAddParent: (childId: string, name: string) => Promise<void>;
  onAddPartner: (personId: string, name: string, kind: UnionKind) => Promise<void>;
  onAddChild: (parentIds: string[], name: string, unionId?: string) => Promise<void>;
  onAddSibling: (personId: string, name: string) => Promise<string | void>;
  onLinkExisting: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind) => Promise<void>;
  onSetUnionKind: (unionId: string, kind: UnionKind) => Promise<void>;
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
  onEdit,
  onRemove,
}: Props) {
  const titleId = useId();
  const [mode, setMode] = useState<Mode>("closed");
  const [rel, setRel] = useState<Rel>("child");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<UnionKind>("partnered");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [bio, setBio] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otherLabel, setOtherLabel] = useState("");
  const [otherDate, setOtherDate] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [linkOther, setLinkOther] = useState<Person | null>(null);
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    if (person) {
      setMode("actions");
      setGivenName(person.givenName);
      setFamilyName(person.familyName ?? "");
      setBio(person.bio ?? "");
      setBirthDate(person.birthDate ?? "");
      setEmail(person.emails?.[0] ?? "");
      setPhone(person.phones?.[0] ?? "");
      setOtherLabel(person.otherDates?.[0]?.label ?? "");
      setOtherDate(person.otherDates?.[0]?.date ?? "");
      setName("");
      setHint(null);
      setLinkOther(null);
    } else {
      setMode("closed");
    }
  }, [person]);

  function onSheetTouchStart(event: TouchEvent) {
    swipeStart.current = event.touches[0]?.clientY ?? null;
  }

  function onSheetTouchEnd(event: TouchEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start == null) return;
    const dy = (event.changedTouches[0]?.clientY ?? start) - start;
    if (dy > 72) onClose();
  }

  if (!person || mode === "closed") return null;

  const unions = unionsFor(tree, person.id);
  const defaultParents =
    unions[0]?.partnerIds.filter((id) => tree.people.some((p) => p.id === id)) ?? [person.id];
  const hasParents = parentsOf(tree, person.id).length > 0;

  function startAdd(next: Rel) {
    if (next === "sibling" && !hasParents) {
      setHint("Add a parent first");
      return;
    }
    setRel(next);
    setMode("add");
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

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !person) return;
    if (rel === "parent") await onAddParent(person.id, name);
    if (rel === "partner") await onAddPartner(person.id, name, kind);
    if (rel === "child") await onAddChild(defaultParents, name, unions[0]?.id);
    if (rel === "sibling") await onAddSibling(person.id, name);
    setName("");
    onClose();
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
      otherDates:
        otherLabel && otherDate
          ? [{ id: person.otherDates?.[0]?.id ?? "d1", label: otherLabel, date: otherDate }]
          : undefined,
    });
    onClose();
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
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>{displayName(person)}</h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            Close
          </button>
        </div>
        {hint ? <p className="error">{hint}</p> : null}
        {mode === "actions" ? (
          <>
            <form className="name-front" onSubmit={async (e) => { e.preventDefault(); await saveNames(); }}>
              <div className="field">
                <label htmlFor="front-given">Given name</label>
                <input id="front-given" value={givenName} onChange={(e) => setGivenName(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="front-family">Family name</label>
                <input id="front-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
              </div>
              <button className="btn" type="submit">Save</button>
            </form>
            <div className="actions">
              <button type="button" className="btn" onClick={() => startAdd("parent")}>Add parent</button>
              <button type="button" className="btn" onClick={() => startAdd("partner")}>Add partner</button>
              <button type="button" className="btn" onClick={() => startAdd("child")}>Add child</button>
              <button type="button" className="btn" onClick={() => startAdd("sibling")}>Add sibling</button>
              <button type="button" className="btn" onClick={() => { setLinkOther(null); setMode("link"); }}>Link someone on the tree</button>
              <button type="button" className="btn primary" onClick={() => setMode("more")}>More</button>
              <button type="button" className="btn danger" onClick={() => void deletePerson()}>Delete</button>
            </div>
            {unions.map((u) => (
              <div className="field" key={u.id}>
                <label htmlFor={`union-${u.id}`}>Couple type</label>
                <select id={`union-${u.id}`} value={u.kind} onChange={(e) => onSetUnionKind(u.id, e.target.value as UnionKind)}>
                  <option value="partnered">Partnered</option>
                  <option value="married">Married</option>
                  <option value="separated">Two households / separated</option>
                  <option value="unspecified">Unspecified</option>
                </select>
              </div>
            ))}
          </>
        ) : null}
        {mode === "add" ? (
          <form onSubmit={submitAdd}>
            <div className="field">
              <label htmlFor="rel-name">
                {rel === "parent" ? "Parent's name" : rel === "partner" ? "Partner's name" : rel === "sibling" ? "Sibling's name" : "Child's name"}
              </label>
              <input id="rel-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            {rel === "partner" ? (
              <div className="field">
                <label htmlFor="union-kind">How they fit</label>
                <select id="union-kind" value={kind} onChange={(e) => setKind(e.target.value as UnionKind)}>
                  <option value="partnered">Partnered</option>
                  <option value="married">Married</option>
                  <option value="separated">Two households / separated</option>
                  <option value="unspecified">Unspecified</option>
                </select>
              </div>
            ) : null}
            {rel === "child" && defaultParents.length > 1 ? <p className="hint">This child will sit under the couple.</p> : null}
            <div className="actions">
              <button className="btn primary" type="submit">Add</button>
              <button className="btn ghost" type="button" onClick={() => setMode("actions")}>Back</button>
            </div>
          </form>
        ) : null}
        {mode === "link" ? (
          linkOther ? (
            <div className="link-roles">
              <p>How is {displayName(linkOther)} linked to {displayName(person)}?</p>
              <button type="button" className="btn" onClick={async () => { await onLinkExisting(person.id, linkOther.id, "parent"); onClose(); }}>Parent</button>
              <button type="button" className="btn" onClick={async () => { await onLinkExisting(person.id, linkOther.id, "partner"); onClose(); }}>Partner</button>
              <button type="button" className="btn" onClick={async () => { await onLinkExisting(person.id, linkOther.id, "child"); onClose(); }}>Child</button>
              <button type="button" className="btn ghost" onClick={() => setLinkOther(null)}>Back</button>
            </div>
          ) : (
            <PeopleList
              tree={tree}
              title="Link someone already on the tree"
              excludeId={person.id}
              embedded
              onClose={() => setMode("actions")}
              onPick={(other) => setLinkOther(other)}
            />
          )
        ) : null}
        {mode === "more" ? (
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
            <div className="actions">
              <button className="btn primary" type="submit">Save</button>
              <button className="btn" type="button" onClick={() => downloadVCard(person)}>Download vCard</button>
              <button className="btn ghost" type="button" onClick={() => setMode("actions")}>Back</button>
              <button className="btn danger" type="button" onClick={() => void deletePerson()}>Delete</button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
