import type { Person } from "./types";
import { displayName } from "./types";

function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function personToVCard(person: Person): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(person.familyName ?? "")};${esc(person.givenName)};;;`,
    `FN:${esc(displayName(person))}`,
  ];
  if (person.birthDate) lines.push(`BDAY:${person.birthDate.replace(/-/g, "")}`);
  for (const email of person.emails ?? []) lines.push(`EMAIL:${esc(email)}`);
  for (const phone of person.phones ?? []) lines.push(`TEL:${esc(phone)}`);
  if (person.bio) lines.push(`NOTE:${esc(person.bio)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function vcardFilename(person: Person): string {
  const base = displayName(person).replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "person";
  return `${base}.vcf`;
}
