import { File } from 'expo-file-system';

/**
 * iOS and Android: the picker has already cropped the photo to a square and re-encoded it.
 * `avatarFiles.web.ts` covers web. Both export the same function.
 */
export async function readPickedImage(asset: { uri: string; file?: Blob }): Promise<Uint8Array> {
  return new File(asset.uri).bytes();
}
