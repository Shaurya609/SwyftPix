import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type PptxPreviewNativeModule = {
  renderPptxHtml(uri: string): Promise<string | null>;
};

export async function renderPptxHtml(uri: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const native = requireNativeModule<PptxPreviewNativeModule>('SwyftPixPptxPreview');
    return await native.renderPptxHtml(uri);
  } catch (error) {
    console.warn('[SwyftPixPptxPreview] PPTX visual rendering failed:', error);
    return null;
  }
}
