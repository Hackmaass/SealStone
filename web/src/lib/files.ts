import { fileSha256, textHash } from "@mv/shared";

export interface HashedFile {
  name: string;
  size: number;
  /** SHA-256 of the bytes, 0x-prefixed. This is what the contract stores as the deliverable hash. */
  hash: string;
}

export async function hashFile(file: File): Promise<HashedFile> {
  return { name: file.name, size: file.size, hash: await fileSha256(new Uint8Array(await file.arrayBuffer())) };
}

/** A pasted text deliverable (for example a git commit SHA): the SHA-256 of its UTF-8 bytes. */
export async function hashText(name: string, text: string): Promise<HashedFile> {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, hash: await fileSha256(bytes) };
}

/** Fictional demo deliverables shipped with the app, so a swapped-file demo needs two clicks and no real files. */
export const DEMO_FILES = [
  { path: "/demo/m1-report.pdf", name: "m1-report.pdf", note: "The report the team submitted for the demo vault" },
  { path: "/demo/m1-report-v2.pdf", name: "m1-report-v2.pdf", note: "A look-alike with different contents" },
] as const;

export async function loadDemoFile(path: string, name: string): Promise<HashedFile> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load the demo file ${name}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { name, size: bytes.length, hash: await fileSha256(bytes) };
}

/** Evidence and rationale texts are committed as keccak256(utf8). */
export const noteHash = (text: string): string => textHash(text);
