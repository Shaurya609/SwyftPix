import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { MockMediaItem } from '@/types/media';
import { lockPortrait, lockPptxLandscape, renderPptxHtml } from '@/modules/swyftpix-media-delete/pptx-preview';
import SwyftPixPptxPreviewView from '@/modules/swyftpix-media-delete/src/SwyftPixPptxPreviewView';

interface PptxPreviewProps {
  item: MockMediaItem;
  thumbnail?: boolean;
}

export function PptxPreview({ item, thumbnail = false }: PptxPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (thumbnail) return;
    lockPptxLandscape();
    return () => lockPortrait();
  }, [thumbnail]);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setLoading(true);
    renderPptxHtml(item.uri).then(result => {
      if (cancelled) return;
      if (!result) {
        setLoading(false);
        return;
      }
      const prepared = thumbnail
        ? result.replace('</head>', '<style>.pptx-controls{display:none}.slide{margin:0 auto}</style></head>')
        : result;
      setHtml(prepared);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setHtml(null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.id, item.uri, thumbnail]);

  if (!html) {
    return (
      <View style={styles.container}>
        {loading ? <ActivityIndicator size="large" color="#0A7EA4" /> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SwyftPixPptxPreviewView key={`${item.id}-${item.uri}-${thumbnail ? 'thumb' : 'full'}`} html={html} style={styles.nativeView} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', height: '100%', backgroundColor: '#242424', overflow: 'hidden', justifyContent: 'center' },
  nativeView: { flex: 1, width: '100%', height: '100%' },
});
