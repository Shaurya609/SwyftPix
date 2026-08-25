import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type OfficePreviewNativeModule = {
  readOfficeDocument(uri: string, type: 'docx' | 'xlsx' | 'pptx', maxChars: number): Promise<string | null>;
};

export async function readOfficeDocument(
  uri: string,
  type: 'docx' | 'xlsx' | 'pptx',
  maxChars = 300000,
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const native = requireNativeModule<OfficePreviewNativeModule>('SwyftPixOfficePreview');
    return await native.readOfficeDocument(uri, type, Math.max(4096, Math.min(maxChars, 300000)));
  } catch (error) {
    console.warn('[SwyftPixOfficePreview] Office preview failed:', error);
    return null;
  }
}
