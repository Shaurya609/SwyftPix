import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, PixelRatio, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MockMediaItem } from '../types/media';
import { formatFileSize, formatDate } from '../utils/formatters';
import { getPdfPageCount, renderPdfPage } from '../modules/swyftpix-media-delete';

interface DocumentPreviewProps { item: MockMediaItem; thumbnail?: boolean; }

const AnimatedImage = Animated.createAnimatedComponent(Image);

function isPdfDocument(item: MockMediaItem) {
  return item.fileType === 'pdf' || item.fileName.toLowerCase().endsWith('.pdf') || item.mimeType?.toLowerCase() === 'application/pdf';
}

function getPdfRenderWidth(width: number, thumbnail: boolean) {
  if (thumbnail) return 900;
  return Math.min(Math.max(Math.round(width * PixelRatio.get() * 2.5), 1800), 2400);
}

export function DocumentPreview({ item, thumbnail = false }: DocumentPreviewProps) {
  const { width } = useWindowDimensions();
  const isPdf = isPdfDocument(item);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(isPdf);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const resetZoom = () => {
    scale.value = withSpring(1, { damping: 18, stiffness: 220 });
    savedScale.value = 1;
    translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
    startX.value = 0;
    startY.value = 0;
  };

  useEffect(() => {
    let cancelled = false;
    setPageIndex(0);
    setPageUri(null);
    resetZoom();
    if (!isPdf) { setPageCount(0); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const count = await getPdfPageCount(item.uri);
      if (cancelled) return;
      setPageCount(count);
      if (count > 0) {
        const rendered = await renderPdfPage(item.uri, 0, getPdfRenderWidth(width, thumbnail));
        if (!cancelled) setPageUri(rendered);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [item.uri, isPdf, thumbnail, width]);

  useEffect(() => {
    if (thumbnail || !isPdf || pageCount <= 0) return;
    let cancelled = false;
    resetZoom();
    setLoading(true);
    renderPdfPage(item.uri, pageIndex, getPdfRenderWidth(width, false)).then(uri => {
      if (cancelled) return;
      setPageUri(uri);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.uri, pageIndex, pageCount, thumbnail, isPdf, width]);

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withSpring(1, { damping: 18, stiffness: 220 });
        savedScale.value = 1;
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      } else {
        savedScale.value = scale.value;
      }
    }), []);

  const panGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate(event => {
      if (scale.value <= 1.01) return;
      const maxOffset = 220 * (scale.value - 1);
      translateX.value = Math.min(maxOffset, Math.max(-maxOffset, startX.value + event.translationX));
      translateY.value = Math.min(maxOffset, Math.max(-maxOffset, startY.value + event.translationY));
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    }), []);

  const gesture = useMemo(() => Gesture.Simultaneous(pinchGesture, panGesture), [pinchGesture, panGesture]);

  const pageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const goToPage = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= pageCount) return;
    setPageIndex(nextIndex);
  };

  if (thumbnail) {
    return (
      <View style={styles.thumbnailContainer}>
        {isPdf && pageUri ? <Image source={{ uri: pageUri }} style={styles.thumbnailPage} contentFit="contain" /> : null}
        {isPdf && loading ? <View style={styles.thumbnailLoading}><ActivityIndicator size="large" color="#0A7EA4" /></View> : null}
        {!isPdf || (!pageUri && !loading) ? <View style={styles.thumbnailFallback}><View style={[styles.iconCircle, isPdf ? styles.pdfCircle : styles.documentCircle]}><MaterialIcons name={isPdf ? 'picture-as-pdf' : 'description'} size={56} color="#FFFFFF" /></View><Text style={styles.thumbnailLabel}>{isPdf ? 'PDF' : 'DOCUMENT'}</Text></View> : null}
      </View>
    );
  }

  if (isPdf && pageUri) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.container}>
          <View style={styles.viewerWrap}>
            <GestureDetector gesture={gesture}>
              <Animated.View style={styles.gestureArea}>
                <AnimatedImage source={{ uri: pageUri }} style={[styles.page, pageAnimatedStyle]} contentFit="contain" />
              </Animated.View>
            </GestureDetector>
            {loading ? <View style={styles.loadingOverlay}><ActivityIndicator size="large" color="#0A7EA4" /></View> : null}
            {pageCount > 1 ? <View style={styles.pageControls}>
              <TouchableOpacity style={styles.pageButton} disabled={pageIndex === 0 || loading} onPress={() => goToPage(pageIndex - 1)}><MaterialIcons name="chevron-left" size={28} color={pageIndex === 0 || loading ? '#666666' : '#FFFFFF'} /></TouchableOpacity>
              <Text style={styles.pageLabel}>Page {pageIndex + 1} of {pageCount}</Text>
              <TouchableOpacity style={styles.pageButton} disabled={pageIndex === pageCount - 1 || loading} onPress={() => goToPage(pageIndex + 1)}><MaterialIcons name="chevron-right" size={28} color={pageIndex === pageCount - 1 || loading ? '#666666' : '#FFFFFF'} /></TouchableOpacity>
            </View> : null}
            <View style={styles.zoomHint}><MaterialIcons name="zoom-in" size={16} color="#FFFFFF" /><Text style={styles.zoomHintText}>Pinch to zoom</Text></View>
          </View>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <View style={styles.genericViewer}>
      {isPdf && loading ? <ActivityIndicator size="large" color="#0A7EA4" /> : <View style={[styles.iconCircle, isPdf ? styles.pdfCircle : styles.documentCircle]}><MaterialIcons name={isPdf ? 'picture-as-pdf' : 'description'} size={68} color="#FFFFFF" /></View>}
      <Text style={styles.typeLabel}>{isPdf ? 'PDF DOCUMENT' : 'DOCUMENT'}</Text>
      <Text style={styles.fileName} numberOfLines={3}>{item.fileName}</Text>
      <View style={styles.metaRow}><Text style={styles.meta}>{formatFileSize(item.fileSize)}</Text><View style={styles.dot} /><Text style={styles.meta}>{formatDate(item.dateCreated)}</Text></View>
      <Text style={styles.safeNote}>{isPdf ? (loading ? 'Preparing an in-app preview…' : 'PDF preview could not be rendered on this device.') : 'In-app preview is currently available for PDF documents. This file can still be opened with a compatible device app.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%' },
  container: { flex: 1, width: '100%', backgroundColor: '#101010' },
  viewerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12, overflow: 'hidden' },
  gestureArea: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  page: { width: '100%', height: '100%' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(16,16,16,0.35)' },
  pageControls: { position: 'absolute', bottom: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.82)', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 22 },
  pageButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  pageLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', minWidth: 90, textAlign: 'center' },
  zoomHint: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.68)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18 },
  zoomHintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  genericViewer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#101010' },
  iconCircle: { width: 150, height: 150, borderRadius: 75, justifyContent: 'center', alignItems: 'center', marginBottom: 22 },
  pdfCircle: { backgroundColor: '#FF3B30' }, documentCircle: { backgroundColor: '#3478F6' },
  typeLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1.8, marginBottom: 12 },
  fileName: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center', maxWidth: 340 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 }, meta: { color: '#B0B0B0', fontSize: 13 }, dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#777777', marginHorizontal: 9 },
  safeNote: { color: '#777777', fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 330, marginTop: 20 },
  thumbnailContainer: { flex: 1, width: '100%', height: '100%', backgroundColor: '#EDEDED', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  thumbnailPage: { width: '100%', height: '100%' }, thumbnailLoading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EDEDED' },
  thumbnailFallback: { alignItems: 'center', justifyContent: 'center' }, thumbnailLabel: { color: '#333333', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginTop: 4 },
});