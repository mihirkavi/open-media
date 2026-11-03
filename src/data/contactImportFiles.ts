import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { readFileText } from './profileImportFiles';

// Browsers label .vcf files inconsistently, so the web picker also accepts them by extension.
const mimeTypes = ['text/vcard', 'text/x-vcard', 'text/directory', 'text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'];

/** Contacts files the person picks (vCard or CSV), read as text on the device. Nothing is uploaded until they confirm. */
export async function pickContactsFiles(): Promise<{ name: string; text: string }[]> {
  const picked = await DocumentPicker.getDocumentAsync({ type: [...mimeTypes, ...(Platform.OS === 'web' ? ['.vcf', '.csv'] : [])], multiple: true, copyToCacheDirectory: true, base64: false });
  if (picked.canceled) return [];
  return Promise.all(picked.assets.map(async (asset) => ({ name: asset.name, text: await readFileText({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType, size: asset.size, file: asset.file }) })));
}
