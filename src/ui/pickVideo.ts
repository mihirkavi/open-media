import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PickedVideo } from '../data/videoUpload';
import { maxVideoSeconds } from '../domain/postVideo';

export type PickResult = { video: PickedVideo } | { cancelled: true } | { error: string };

/** Recording opens the camera on iOS and Android. On web, the file chooser also offers the camera on phones. */
export const canRecordVideo = Platform.OS !== 'web';

/**
 * Picks a video from the library or records one, capped at 3 minutes where the platform allows.
 * Must be called straight from a tap: browsers block file choosers opened any other way.
 */
export async function pickVideo(source: 'library' | 'camera'): Promise<PickResult> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { error: 'Allow camera access in Settings to record a video.' };
    } else if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted && permission.accessPrivileges !== 'limited') return { error: 'Allow photo library access in Settings to choose a video.' };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      videoMaxDuration: maxVideoSeconds,
      allowsEditing: false,
      // Compatible asks iOS for H.264 MP4/MOV that every network and browser can play.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
    };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { cancelled: true };
    const asset = result.assets[0];
    return {
      video: {
        uri: asset.uri,
        file: asset.file,
        fileName: asset.fileName ?? asset.file?.name,
        mimeType: asset.mimeType ?? asset.file?.type,
        sizeBytes: asset.fileSize ?? asset.file?.size,
        // Milliseconds on iOS and Android; expo-image-picker's web build reports the <video> duration in seconds.
        durationSeconds: asset.duration ? (Platform.OS === 'web' ? asset.duration : asset.duration / 1000) : undefined,
        width: asset.width || undefined,
        height: asset.height || undefined,
      },
    };
  } catch {
    return { error: source === 'camera' ? 'The camera couldn’t start. Try choosing a video instead.' : 'The video picker couldn’t open. Try again.' };
  }
}
