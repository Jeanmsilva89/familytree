import type { ChildLink, Person, TreeData, Union, UnionKind } from "./types";
import { emptyTree } from "./types";
import { newId, nowIso } from "./ids";

type GedLine = { level: number; xref?: string; tag: string; value: string };

function parseLines(text: string): GedLine[] {
  const lines: GedLine[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = raw.replace(/\s+$/, "");
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_@]+)(?:\s+(.*))?$/);
    if (!m) continue;
    lines.push({
      level: Number(m[1]),
      xref: m[2],
      tag: m[3].toUpperCase(),
      value: m[4] ?? "",
    });
  }
  return lines;
}

function dateToGed(iso?: string): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function gedToIso(value: string): string | undefined {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  const m = trimmed.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) {
    const year = trimmed.match(/^(\d{4})$/);
    return year ? `${year[1]}-01-01` : undefined;
  }
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const month = months[m[2].toUpperCase()];
  if (!month) return undefined;
  const day = m[1] ? m[1].padStart(2, "0") : "01";
  return `${m[3]}-${month}-${day}`;
}

function parseName(value: string): { givenName: string; familyName?: string } {
  const m = value.match(/^(.*?)\s*\/([^/]*)\/\s*(.*)$/);
  if (m) {
    const given = [m[1], m[3]].filter(Boolean).join(" ").trim();
    return { givenName: given || "Unknown", familyName: m[2].trim() || undefined };
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { givenName: "Unknown" };
  if (parts.length === 1) return { givenName: parts[0] };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}

function kindFromFam(values: string[]): UnionKind {
  const joined = values.join(" ").toUpperCase();
  if (joined.includes("DIV") || joined.includes("SEPARAT")) return "separated";
  if (joined.includes("MARR") || joined.includes("MARRIED")) return "married";
  return "partnered";
}

export function parseGedcom(text: string): TreeData {
  const lines = parseLines(text);
  const people: Person[] = [];
  const unions: Union[] = [];
  const childLinks: ChildLink[] = [];
  const xrefToId = new Map<string, string>();
  const now = nowIso();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.level === 0 && line.tag === "INDI" && line.xref) {
      const xref = line.xref;
      const id = newId("p");
      xrefToId.set(xref, id);
      let givenName = "Unknown";
      let familyName: string | undefined;
      let bio: string | undefined;
      let birthDate: string | undefined;
      const emails: string[] = [];
      const phones: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].level > 0) {
        const cur = lines[i];
        if (cur.level === 1 && cur.tag === "NAME") {
          const parsed = parseName(cur.value);
          givenName = parsed.givenName;
          familyName = parsed.familyName;
        } else if (cur.level === 1 && cur.tag === "BIRT") {
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "DATE") birthDate = gedToIso(lines[i].value);
            i += 1;
          }
          continue;
        } else if (cur.level === 1 && (cur.tag === "NOTE" || cur.tag === "NSFX")) {
          bio = [bio, cur.value].filter(Boolean).join("\n");
        } else if (cur.level === 1 && (cur.tag === "EMAIL" || cur.tag === "_EMAIL")) {
          emails.push(cur.value);
        } else if (cur.level === 1 && cur.tag === "PHON") {
          phones.push(cur.value);
        }
        i += 1;
      }
      people.push({
        id,
        givenName,
        familyName,
        bio,
        birthDate,
        emails: emails.length ? emails : undefined,
        phones: phones.length ? phones : undefined,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    i += 1;
  }

  i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.level === 0 && line.tag === "FAM" && line.xref) {
      const partners: string[] = [];
      const children: string[] = [];
      const events: string[] = [line.tag];
      i += 1;
      while (i < lines.length && lines[i].level > 0) {
        const cur = lines[i];
        if (cur.level === 1 && (cur.tag === "HUSB" || cur.tag === "WIFE")) {
          const pid = xrefToId.get(cur.value.trim());
          if (pid && !partners.includes(pid)) partners.push(pid);
        } else if (cur.level === 1 && cur.tag === "CHIL") {
          const cid = xrefToId.get(cur.value.trim());
          if (cid) children.push(cid);
        } else if (cur.level === 1) {
          events.push(cur.tag);
        }
        i += 1;
      }
      if (partners.length === 0 && children.length === 0) continue;
      const union: Union | undefined =
        partners.length > 0
          ? { id: newId("u"), partnerIds: partners, kind: kindFromFam(events) }
          : undefined;
      if (union) unions.push(union);
      for (const childId of children) {
        childLinks.push({
          id: newId("c"),
          childId,
          parentIds: partners.length ? partners : [],
          unionId: union?.id,
        });
      }
      continue;
    }
    i += 1;
  }

  const cleaned = childLinks.filter((l) => l.parentIds.length > 0);
  return {
    people,
    unions,
    childLinks: cleaned,
    focusPersonId: people[0]?.id,
  };
}

export function serializeGedcom(tree: TreeData): string {
  const idToXref = new Map<string, string>();
  tree.people.forEach((p, idx) => idToXref.set(p.id, `@I${idx + 1}@`));
  const lines: string[] = [
    "0 HEAD",
    "1 SOUR Family Tree",
    "2 VERS 0.1",
    "2 NAME Family Tree",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
  ];

  for (const person of tree.people) {
    const xref = idToXref.get(person.id)!;
    const slashed = person.familyName
      ? `${person.givenName} /${person.familyName}/`
      : `${person.givenName} //`;
    lines.push(`0 ${xref} INDI`);
    lines.push(`1 NAME ${slashed}`);
    if (person.birthDate) {
      lines.push("1 BIRT");
      lines.push(`2 DATE ${dateToGed(person.birthDate)}`);
    }
    if (person.bio) {
      for (const part of person.bio.split(/\n+/)) {
        if (part.trim()) lines.push(`1 NOTE ${part.trim()}`);
      }
    }
    for (const email of person.emails ?? []) lines.push(`1 EMAIL ${email}`);
    for (const phone of person.phones ?? []) lines.push(`1 PHON ${phone}`);
  }

  const famKeys = new Map<string, { partners: string[]; children: string[]; kind: UnionKind; unionId?: string }>();

  for (const union of tree.unions) {
    const key = [...union.partnerIds].sort().join("|");
    famKeys.set(key, {
      partners: union.partnerIds,
      children: [],
      kind: union.kind,
      unionId: union.id,
    });
  }

  for (const link of tree.childLinks) {
    const key = [...link.parentIds].sort().join("|");
    const existing = famKeys.get(key);
    if (existing) {
      existing.children.push(link.childId);
    } else {
      famKeys.set(key, {
        partners: link.parentIds,
        children: [link.childId],
        kind: "unspecified",
      });
    }
  }

  let famIndex = 1;
  for (const fam of famKeys.values()) {
    const xref = `@F${famIndex}@`;
    famIndex += 1;
    lines.push(`0 ${xref} FAM`);
    if (fam.partners[0]) lines.push(`1 HUSB ${idToXref.get(fam.partners[0])}`);
    if (fam.partners[1]) lines.push(`1 WIFE ${idToXref.get(fam.partners[1])}`);
    if (fam.kind === "married") {
      lines.push("1 MARR");
    } else if (fam.kind === "separated") {
      lines.push("1 DIV");
    }
    for (const childId of fam.children) {
      const cx = idToXref.get(childId);
      if (cx) lines.push(`1 CHIL ${cx}`);
    }
  }

  lines.push("0 TRLR");
  return lines.join("\n") + "\n";
}

export function emptyFromParse(): TreeData {
  return emptyTree();
}
