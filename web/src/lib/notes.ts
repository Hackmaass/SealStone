import { api } from "./api";

/**
 * Evidence and rationale texts: the chain stores only their keccak256, so the readable text is kept by the AI service
 * (it refuses any text that does not hash to the key) and, always, in this browser, so it still works with the server off.
 */
const KEY = "mv.notes.v1";

function readLocal(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function saveNote(hash: string, text: string): Promise<void> {
  try {
    const all = readLocal();
    all[hash] = text;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the server copy still works */
  }
  try {
    await api.saveNote(hash, text);
  } catch {
    /* server offline: the browser copy is enough for this demo */
  }
}

export async function loadNote(hash: string): Promise<string | null> {
  const local = readLocal()[hash];
  if (local !== undefined) return local;
  try {
    return (await api.note(hash)).text;
  } catch {
    return null;
  }
}
