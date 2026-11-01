import { File } from 'expo-file-system';

/**
 * iOS and Android: reading a file picked for profile import (ADR 0020). `profileImportFiles.web.ts`
 * covers web. Both export the same functions.
 */

export interface PickedFile { name: string; uri: string; mimeType?: string; size?: number; file?: Blob }

export async function readFileBase64(picked: PickedFile): Promise<string> {
  return new File(picked.uri).base64();
}

export async function readFileText(picked: PickedFile): Promise<string> {
  return new File(picked.uri).text();
}

/** The CSV files inside LinkedIn's data-export archive. Phones can't unzip here; the person opens the archive in Files first. */
export async function csvFilesInZip(_picked: PickedFile): Promise<Record<string, string>> {
  throw new Error('Open the LinkedIn archive in the Files app to unzip it, then choose Profile.csv, Positions.csv, Education.csv and Skills.csv.');
}
