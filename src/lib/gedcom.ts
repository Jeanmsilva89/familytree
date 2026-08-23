/**
 * Kinstart GEDCOM 1.0
 *
 * GEDCOM 5.5.1 lineage-linked file, plus `_KIN` tags for living-family facts
 * that classic genealogy files do not cover (occupation, nicknames, couple
 * kind, free-form key/value). Standard readers ignore unknown `_` tags.
 *
 *   0 HEAD
 *   1 SOUR Kinstart
 *   1 GEDC / 2 VERS 5.5.1
 *   1 CHAR UTF-8
 *   1 _KIN 1.0
 *
 * INDI:
 *   1 NAME Given /Family/
 *   1 BIRT / 2 DATE
 *   1 EMAIL, 1 PHON, 1 NOTE
 *   1 EVEN / 2 TYPE <label> / 2 DATE  — important dates
 *   1 _KV <key> / 2 _VAL <value>      — arbitrary extras
 *   1 _PID <stable id>
 *   1 FAMS / 1 FAMC
 *
 * FAM:
 *   1 HUSB / 1 WIFE / 1 CHIL
 *   1 MARR or 1 DIV / 2 DATE
 *   1 _KIND married|partnered|separated|unspecified
 *   1 _KV / 2 _VAL
 *   1 _UID <stable id>
 */
import type { ChildLink, ExtraField, Person, TreeData, Union, UnionKind } from "./types";
import { cleanExtras, emptyTree } from "./types";
import { newId, nowIso } from "./ids";

type GedLine = { level: number; xref?: string; tag: string; value: string };

const KIN_VERSION = "1.0";

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

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function kindFromFam(kindTag: string | undefined, events: string[]): UnionKind {
  const tagged = (kindTag ?? "").toLowerCase();
  if (tagged === "married" || tagged === "partnered" || tagged === "separated" || tagged === "unspecified") {
    return tagged;
  }
  const joined = events.join(" ").toUpperCase();
  if (joined.includes("DIV") || joined.includes("SEPARAT")) return "separated";
  if (joined.includes("MARR") || joined.includes("MARRIED")) return "married";
  return "partnered";
}

function emitKv(lines: string[], extras?: ExtraField[]) {
  for (const item of cleanExtras(extras) ?? []) {
    lines.push(`1 _KV ${oneLine(item.key)}`);
    lines.push(`2 _VAL ${oneLine(item.value)}`);
  }
}

export function parseGedcom(text: string): TreeData {
  const lines = parseLines(text);
  const people: Person[] = [];
  const unions: Union[] = [];
  const childLinks: ChildLink[] = [];
  const xrefToId = new Map<string, string>();
  const usedIds = new Set<string>();
  const now = nowIso();

  const stableId = (raw: string | undefined, prefix: string, fallbackXref?: string) => {
    const token = (raw || fallbackXref || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (token && !usedIds.has(token)) {
      usedIds.add(token);
      return token;
    }
    let id = newId(prefix);
    while (usedIds.has(id)) id = newId(prefix);
    usedIds.add(id);
    return id;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.level === 0 && line.tag === "INDI" && line.xref) {
      const xref = line.xref;
      let givenName = "Unknown";
      let familyName: string | undefined;
      let bio: string | undefined;
      let birthDate: string | undefined;
      let pid: string | undefined;
      const emails: string[] = [];
      const phones: string[] = [];
      const extras: ExtraField[] = [];
      const otherDates: Person["otherDates"] = [];
      i += 1;
      while (i < lines.length && lines[i].level > 0) {
        const cur = lines[i];
        if (cur.level === 1 && cur.tag === "NAME") {
          const parsed = parseName(cur.value);
          givenName = parsed.givenName;
          familyName = parsed.familyName;
          i += 1;
        } else if (cur.level === 1 && cur.tag === "BIRT") {
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "DATE") birthDate = gedToIso(lines[i].value);
            i += 1;
          }
        } else if (cur.level === 1 && cur.tag === "EVEN") {
          let type = "";
          let date = "";
          let note = "";
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "TYPE") type = lines[i].value.trim();
            else if (lines[i].tag === "DATE") date = gedToIso(lines[i].value) ?? "";
            else if (lines[i].tag === "NOTE") note = lines[i].value.trim();
            i += 1;
          }
          if (type && date) otherDates.push({ id: newId("d"), label: type, date });
          else if (type && note) extras.push({ key: type, value: note });
          else if (note) extras.push({ key: type || "note", value: note });
        } else if (cur.level === 1 && cur.tag === "_KV") {
          const key = cur.value.trim();
          let value = "";
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "_VAL") value = [value, lines[i].value].filter(Boolean).join("\n");
            i += 1;
          }
          if (key && value.trim()) extras.push({ key, value: value.trim() });
        } else if (cur.level === 1 && (cur.tag === "NOTE" || cur.tag === "NSFX")) {
          bio = [bio, cur.value].filter(Boolean).join("\n");
          i += 1;
        } else if (cur.level === 1 && (cur.tag === "EMAIL" || cur.tag === "_EMAIL")) {
          emails.push(cur.value);
          i += 1;
        } else if (cur.level === 1 && cur.tag === "PHON") {
          phones.push(cur.value);
          i += 1;
        } else if (cur.level === 1 && (cur.tag === "_PID" || cur.tag === "_ID")) {
          pid = cur.value.trim();
          i += 1;
        } else {
          i += 1;
        }
      }
      const id = stableId(pid, "p", xref);
      xrefToId.set(xref, id);
      people.push({
        id,
        givenName,
        familyName,
        bio,
        birthDate,
        otherDates: otherDates.length ? otherDates : undefined,
        emails: emails.length ? emails : undefined,
        phones: phones.length ? phones : undefined,
        extras: cleanExtras(extras),
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
      const extras: ExtraField[] = [];
      let kindTag: string | undefined;
      let marriedOn: string | undefined;
      let uid: string | undefined;
      i += 1;
      while (i < lines.length && lines[i].level > 0) {
        const cur = lines[i];
        if (cur.level === 1 && (cur.tag === "HUSB" || cur.tag === "WIFE")) {
          const pid = xrefToId.get(cur.value.trim());
          if (pid && !partners.includes(pid)) partners.push(pid);
          i += 1;
        } else if (cur.level === 1 && cur.tag === "CHIL") {
          const cid = xrefToId.get(cur.value.trim());
          if (cid) children.push(cid);
          i += 1;
        } else if (cur.level === 1 && cur.tag === "_KIND") {
          kindTag = cur.value.trim();
          i += 1;
        } else if (cur.level === 1 && cur.tag === "_KV") {
          const key = cur.value.trim();
          let value = "";
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "_VAL") value = [value, lines[i].value].filter(Boolean).join("\n");
            i += 1;
          }
          if (key && value.trim()) extras.push({ key, value: value.trim() });
        } else if (cur.level === 1 && (cur.tag === "MARR" || cur.tag === "DIV")) {
          events.push(cur.tag);
          i += 1;
          while (i < lines.length && lines[i].level > 1) {
            if (lines[i].tag === "DATE") marriedOn = gedToIso(lines[i].value);
            i += 1;
          }
        } else if (cur.level === 1 && (cur.tag === "_UID" || cur.tag === "_ID")) {
          uid = cur.value.trim();
          i += 1;
        } else {
          if (cur.level === 1) events.push(cur.tag);
          i += 1;
        }
      }
      if (partners.length === 0 && children.length === 0) continue;
      const union: Union | undefined =
        partners.length > 0
          ? {
              id: stableId(uid, "u", line.xref),
              partnerIds: partners,
              kind: kindFromFam(kindTag, events),
              marriedOn,
              extras: cleanExtras(extras),
            }
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
    "1 SOUR Kinstart",
    "2 VERS 1.0",
    "2 NAME Kinstart",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
    `1 _KIN ${KIN_VERSION}`,
  ];

  const famKeys = new Map<string, { partners: string[]; children: string[]; kind: UnionKind; union?: Union }>();

  for (const union of tree.unions) {
    const key = [...union.partnerIds].sort().join("|");
    famKeys.set(key, {
      partners: union.partnerIds,
      children: [],
      kind: union.kind,
      union,
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

  const famXrefByKey = new Map<string, string>();
  const famsOf = new Map<string, string[]>();
  const famcOf = new Map<string, string[]>();
  let famIndex = 1;
  for (const [key, fam] of famKeys) {
    const xref = `@F${famIndex}@`;
    famIndex += 1;
    famXrefByKey.set(key, xref);
    for (const pid of fam.partners) {
      const list = famsOf.get(pid) ?? [];
      list.push(xref);
      famsOf.set(pid, list);
    }
    for (const cid of fam.children) {
      const list = famcOf.get(cid) ?? [];
      list.push(xref);
      famcOf.set(cid, list);
    }
  }

  for (const person of tree.people) {
    const xref = idToXref.get(person.id)!;
    const slashed = person.familyName
      ? `${person.givenName} /${person.familyName}/`
      : `${person.givenName} //`;
    lines.push(`0 ${xref} INDI`);
    lines.push(`1 NAME ${slashed}`);
    lines.push(`1 _PID ${person.id}`);
    if (person.birthDate) {
      lines.push("1 BIRT");
      lines.push(`2 DATE ${dateToGed(person.birthDate)}`);
    }
    for (const date of person.otherDates ?? []) {
      lines.push("1 EVEN");
      lines.push(`2 TYPE ${oneLine(date.label)}`);
      const ged = dateToGed(date.date);
      if (ged) lines.push(`2 DATE ${ged}`);
    }
    if (person.bio) {
      for (const part of person.bio.split(/\n+/)) {
        if (part.trim()) lines.push(`1 NOTE ${oneLine(part)}`);
      }
    }
    for (const email of person.emails ?? []) lines.push(`1 EMAIL ${email}`);
    for (const phone of person.phones ?? []) lines.push(`1 PHON ${phone}`);
    emitKv(lines, person.extras);
    for (const fam of famsOf.get(person.id) ?? []) lines.push(`1 FAMS ${fam}`);
    for (const fam of famcOf.get(person.id) ?? []) lines.push(`1 FAMC ${fam}`);
  }

  for (const [key, fam] of famKeys) {
    const xref = famXrefByKey.get(key)!;
    lines.push(`0 ${xref} FAM`);
    if (fam.union?.id) lines.push(`1 _UID ${fam.union.id}`);
    if (fam.partners[0]) lines.push(`1 HUSB ${idToXref.get(fam.partners[0])}`);
    if (fam.partners[1]) lines.push(`1 WIFE ${idToXref.get(fam.partners[1])}`);
    lines.push(`1 _KIND ${fam.kind}`);
    if (fam.kind === "married") {
      lines.push("1 MARR");
      const ged = dateToGed(fam.union?.marriedOn);
      if (ged) lines.push(`2 DATE ${ged}`);
    } else if (fam.kind === "separated") {
      lines.push("1 DIV");
      const ged = dateToGed(fam.union?.marriedOn);
      if (ged) lines.push(`2 DATE ${ged}`);
    } else if (fam.union?.marriedOn) {
      lines.push("1 MARR");
      lines.push(`2 DATE ${dateToGed(fam.union.marriedOn)}`);
    }
    emitKv(lines, fam.union?.extras);
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
