import { File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

/**
 * Saving the exported contacts (ADR 0036). On the web the browser downloads the .vcf file; on a
 * phone it is written to the app's cache and handed to the system share sheet, from which it can
 * go to Files, Contacts, Mail or another app. Nothing is uploaded.
 */
export async function saveContactsFile(name: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vcard;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  // iOS shares the file itself; Android's share sheet takes text, so it gets the vCard text.
  await Share.share(Platform.OS === 'ios' ? { url: file.uri, title: name } : { title: name, message: text });
}
