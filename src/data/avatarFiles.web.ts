import { avatarSize } from '../domain/avatar';

/**
 * Web: the browser can't crop in the picker, so the photo is center-cropped to a square and drawn
 * at most `avatarSize` pixels on a canvas. Re-encoding drops every bit of metadata with it.
 */
export async function readPickedImage(asset: { uri: string; file?: Blob }): Promise<Uint8Array> {
  const blob = asset.file ?? await (await fetch(asset.uri)).blob();
  const bitmap = await createImageBitmap(blob);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, avatarSize);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!jpeg) throw new Error('That picture couldn’t be read. Try another one.');
  return new Uint8Array(await jpeg.arrayBuffer());
}
