import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { getSupabaseClient } from '../auth/supabase';
import { avatarBucket, avatarContentType, avatarMaxBytes, gravatarAddress, gravatarUrl, stripImageMetadata } from '../domain/avatar';
import { readPickedImage } from './avatarFiles';

/** A picture ready to upload: cleaned bytes, and a URL that shows it before it is saved. */
export interface AvatarChoice { bytes: Uint8Array; previewUrl: string; from: 'photo' | 'gravatar' }

/** Opens the photo library, square-cropped. Must be called straight from a tap on web. */
export async function pickAvatar(): Promise<AvatarChoice | undefined> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && permission.accessPrivileges !== 'limited') throw new Error('Allow photo library access in Settings to choose a picture.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85, exif: false });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return undefined;
  const bytes = stripImageMetadata(await readPickedImage(asset));
  if (bytes.length > avatarMaxBytes) throw new Error('That picture is over 5 MB. Choose a smaller one.');
  return { bytes, previewUrl: asset.uri, from: 'photo' };
}

/** The Gravatar for the signed-in account's email, when its owner made one; nothing otherwise. */
export async function findGravatar(): Promise<AvatarChoice | undefined> {
  const email = (await getSupabaseClient()?.auth.getUser())?.data.user?.email;
  if (!email) return undefined;
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, gravatarAddress(email));
  const url = gravatarUrl(hash);
  const response = await fetch(url).catch(() => undefined);
  if (!response?.ok) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!avatarContentType(bytes) || bytes.length > avatarMaxBytes) return undefined;
  return { bytes: stripImageMetadata(bytes), previewUrl: url, from: 'gravatar' };
}

/** Uploads to the owner's folder in the public bucket and returns the picture's public URL. */
export async function uploadAvatar(choice: AvatarChoice): Promise<string> {
  const client = getSupabaseClient();
  const userId = (await client?.auth.getSession())?.data.session?.user.id;
  if (!client || !userId) throw new Error('Sign in again to change your picture.');
  const contentType = avatarContentType(choice.bytes)!;
  // A new name each time, so every cached copy of the old picture is replaced at once.
  const path = `${userId}/${Date.now()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
  const { error } = await client.storage.from(avatarBucket).upload(path, choice.bytes, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw new Error('Your picture didn’t upload. Try again.');
  return client.storage.from(avatarBucket).getPublicUrl(path).data.publicUrl;
}
