import type { PickedFile } from './profileImportFiles';

/** Web: reading a file picked for profile import through the browser's File. */

export type { PickedFile } from './profileImportFiles';

function fileOf(picked: PickedFile): Blob {
  if (!picked.file) throw new Error('That file couldn’t be read. Choose it again.');
  return picked.file;
}

export async function readFileBase64(picked: PickedFile): Promise<string> {
  const bytes = new Uint8Array(await fileOf(picked).arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function readFileText(picked: PickedFile): Promise<string> {
  return fileOf(picked).text();
}

/** Only these files leave the browser; the rest of the archive (messages, connections) is never read or sent. */
const wanted = /(^|\/)(Profile|Positions|Education|Skills|Languages)\.csv$/i;

/**
 * The CSV files Open Media reads from LinkedIn's data-export archive, unzipped in the browser with
 * its own DecompressionStream. Reads the archive's central directory, then only the wanted entries.
 */
export async function csvFilesInZip(picked: PickedFile): Promise<Record<string, string>> {
  const bytes = new Uint8Array(await fileOf(picked).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('That isn’t a ZIP archive. Choose the archive LinkedIn emailed you, or the CSV files inside it.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Record<string, string> = {};
  for (let index = 0; index < count && at + 46 <= bytes.length; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (!wanted.test(name) || compressed > 2_000_000) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    const raw = method === 0 ? data : method === 8 ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : undefined;
    if (raw) files[name.split('/').pop()!] = new TextDecoder().decode(raw);
  }
  if (!Object.keys(files).length) throw new Error('No Profile.csv or Positions.csv in that archive. Ask LinkedIn for the archive that includes your profile.');
  return files;
}
