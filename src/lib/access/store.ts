import { deleteAccessRecord, readAccessRecord, writeAccessRecord } from "../db";
import { emptyAccess, type AccessState } from "./types";
import { parseAccessValue, serializeAccess } from "./arrange";

export type AccessBackend = {
  get(): Promise<unknown>;
  put(value: unknown): Promise<void>;
  del(): Promise<void>;
};

let memory: AccessState | null = null;
let writeTail: Promise<void> = Promise.resolve();

const idbBackend: AccessBackend = {
  get: () => readAccessRecord(),
  put: (value) => writeAccessRecord(value),
  del: () => deleteAccessRecord(),
};

function clone(access: AccessState): AccessState {
  return parseAccessValue(JSON.parse(serializeAccess(access)));
}

function enqueue(job: () => Promise<void>): Promise<void> {
  writeTail = writeTail.then(job, job);
  return writeTail;
}

export function resetAccessStoreForTests() {
  memory = null;
  writeTail = Promise.resolve();
}

export async function loadAccess(backend: AccessBackend = idbBackend): Promise<AccessState> {
  await writeTail;
  if (memory) return clone(memory);
  const stored = await backend.get();
  if (memory) return clone(memory);
  memory = stored == null ? emptyAccess() : parseAccessValue(stored);
  return clone(memory);
}

export async function saveAccess(access: AccessState, backend: AccessBackend = idbBackend): Promise<void> {
  memory = clone(access);
  const snapshot = memory;
  await enqueue(() => backend.put(JSON.parse(serializeAccess(snapshot))));
}

export async function clearAccess(backend: AccessBackend = idbBackend): Promise<void> {
  memory = emptyAccess();
  await enqueue(() => backend.del());
}
