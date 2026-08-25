import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { formatFileSize, formatDate } from '../utils/formatters';
import { getPdfPageCount, renderPdfPage } from '../modules/swyftpix-media-delete';

interface DocumentPreviewProps { item: MockMediaItem; thumbnail?: boolean; }

function isPdfDocument(item: MockMediaItem) {
  return item.fileType === 'pdf' || item.fileName.toLowerCase().endsWith('.pdf') || item.mimeType?.toLowerCase() === 'application/pdf';
}

export function DocumentPreview({ item, thumbnail = false }: DocumentPreviewProps) {
  const { width } = useWindowDimensions();
  const isPdf = isPdfDocument(item);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUri, setPageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(isPdf);

  useEffect(() => {
    let cancelled = false;
    setPageIndex(0);
    setPageUri(null);
    if (!isPdf) { setPageCount(0); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const count = await getPdfPageCount(item.uri);
      if (cancelled) return;
      setPageCount(count);
      if (count > 0) {
        const rendered = await renderPdfPage(item.uri, 0, thumbnail ? 700 : Math.min(width - 40, 1400));
        if (!cancelled) setPageUri(rendered);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [item.uri, isPdf, thumbnail, width]);

  useEffect(() => {
    if (thumbnail || !isPdf || pageCount <= 0) return;
    let cancelled = false;
    setLoading(true);
    renderPdfPage(item.uri, pageIndex, Math.min(width - 40, 1400)).then(uri => {
      if (cancelled) return;
      setPageUri(uri);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.uri, pageIndex, pageCount, thumbnail, isPdf, width]);

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
      <View style={styles.container}>
        <View style={styles.viewerWrap}>
          <Image source={{ uri: pageUri }} style={styles.page} contentFit="contain" />
          {loading ? <View style={styles.loadingOverlay}><ActivityIndicator size="large" color="#0A7EA4" /></View> : null}
          {pageCount > 1 ? <View style={styles.pageControls}>
            <TouchableOpacity style={styles.pageButton} disabled={pageIndex === 0 || loading} onPress={() => goToPage(pageIndex - 1)}><MaterialIcons name="chevron-left" size={28} color={pageIndex === 0 || loading ? '#666666' : '#FFFFFF'} /></TouchableOpacity>
            <Text style={styles.pageLabel}>Page {pageIndex + 1} of {pageCount}</Text>
            <TouchableOpacity style={styles.pageButton} disabled={pageIndex === pageCount - 1 || loading} onPress={() => goToPage(pageIndex + 1)}><MaterialIcons name="chevron-right" size={28} color={pageIndex === pageCount - 1 || loading ? '#666666' : '#FFFFFF'} /></TouchableOpacity>
          </View> : null}
        </View>
      </View>
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
  container: { flex: 1, width: '100%', backgroundColor: '#101010' },
  viewerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12 },
  page: { width: '100%', height: '100%' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(16,16,16,0.35)' },
  pageControls: { position: 'absolute', bottom: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.82)', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 22 },
  pageButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  pageLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', minWidth: 90, textAlign: 'center' },
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