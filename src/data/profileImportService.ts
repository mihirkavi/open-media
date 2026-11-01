import * as DocumentPicker from 'expo-document-picker';

import { request } from '../connectors/mailApiConnector';
import { ProfileProposal } from '../domain/profileImport';
import { csvFilesInZip, readFileBase64, readFileText } from './profileImportFiles';

/**
 * Filling the profile from LinkedIn or the person's website (ADR 0020). The Worker reads the file
 * or the site and returns proposals; nothing is saved here. Edit profile fills its fields with
 * the ones the person keeps, and they save as usual.
 */

export interface ImportResult { proposals: ProfileProposal[]; pagesRead?: string[]; skipped?: string[] }

/**
 * Lets the person choose LinkedIn's profile PDF, the data-export archive, or CSV files from it, and
 * reads them into proposals. Undefined when they close the picker.
 */
export async function importFromLinkedInFiles(onReading?: () => void): Promise<ImportResult | undefined> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'text/csv', 'text/comma-separated-values', 'application/zip', 'application/x-zip-compressed'], multiple: true, copyToCacheDirectory: true, base64: false });
  if (picked.canceled || !picked.assets?.length) return undefined;
  onReading?.();
  const assets = picked.assets.map((asset) => ({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType, size: asset.size, file: asset.file }));
  const pdf = assets.find((asset) => /\.pdf$/i.test(asset.name) || asset.mimeType === 'application/pdf');
  if (pdf) {
    if ((pdf.size ?? 0) > 2_000_000) throw new Error('That PDF is larger than 2 MB. Use the PDF from your LinkedIn profile → Resources → Save to PDF.');
    return request<ImportResult>('/v1/me/professional/import', { method: 'POST', body: { linkedInPdf: await readFileBase64(pdf) } }, 'That PDF couldn’t be read.');
  }
  const files: Record<string, string> = {};
  for (const asset of assets) {
    if (/\.zip$/i.test(asset.name) || /zip/.test(asset.mimeType ?? '')) Object.assign(files, await csvFilesInZip(asset));
    else if (/\.csv$/i.test(asset.name)) files[asset.name] = (await readFileText(asset)).slice(0, 200_000);
  }
  if (!Object.keys(files).length) throw new Error('Choose LinkedIn’s profile PDF, its data-export archive, or Profile.csv and Positions.csv from it.');
  return request<ImportResult>('/v1/me/professional/import', { method: 'POST', body: { linkedInFiles: files } }, 'Those files couldn’t be read.');
}

/** Reads the person's own website, which they just asked for, into proposals. */
export function importFromWebsite(url: string): Promise<ImportResult> {
  return request<ImportResult>('/v1/me/professional/portfolio', { method: 'POST', body: { url, consent: true } }, 'That site couldn’t be read.');
}
