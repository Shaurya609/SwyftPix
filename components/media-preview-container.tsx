import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, Text } from 'react-native';
import { Image } from 'expo-image';
import { MockMediaItem } from '../types/media';
import { formatFileSize, formatDate } from '../utils/formatters';
import { ThemedText } from './themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { renderPdfPage } from '../modules/swyftpix-media-delete';
import { DocumentPreview } from './document-preview';

interface MediaPreviewContainerProps { item: MockMediaItem; isTop?: boolean; }

export function MediaPreviewContainer({ item, isTop }: MediaPreviewContainerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isAudio = item.fileType === 'audio';
  const isVideo = item.fileType === 'video';
  const isVisual = ['photo', 'screenshot', 'whatsapp', 'video'].includes(item.fileType);
  const isDocument = ['pdf', 'document'].includes(item.fileType);
  const isPdf = item.fileType === 'pdf' || item.fileName.toLowerCase().endsWith('.pdf') || item.mimeType?.toLowerCase() === 'application/pdf';
  const isOffice = ['.docx', '.xlsx', '.pptx'].some(ext => item.fileName.toLowerCase().endsWith(ext));
  const [pdfThumbnail, setPdfThumbnail] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPdfThumbnail(null);
    if (!isPdf) {
      setPdfLoading(false);
      return;
    }
    setPdfLoading(true);
    renderPdfPage(item.uri, 0, 900).then(uri => {
      if (cancelled) return;
      setPdfThumbnail(uri);
      setPdfLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPdfThumbnail(null);
      setPdfLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.id, item.uri, isPdf]);

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'Camera': return '#007AFF';
      case 'Screenshots': return '#AF52DE';
      case 'WhatsApp': return '#34C759';
      case 'Downloads': return '#FF9500';
      case 'Documents': return '#5856D6';
      case 'Videos': return '#FF2D55';
      case 'Music': return '#5856D6';
      case 'Archives': return '#8E8E93';
      case 'APKs': return '#34C759';
      default: return '#8E8E93';
    }
  };

  const getFileIcon = () => {
    switch (item.fileType) {
      case 'video': return 'videocam'; case 'audio': return 'audiotrack'; case 'pdf': return 'picture-as-pdf'; case 'document': return 'description'; case 'archive': return 'folder-zip'; case 'apk': return 'android'; case 'screenshot': return 'phonelink-setup'; case 'whatsapp': return 'chat'; default: return 'photo';
    }
  };

  const getGenericColor = () => {
    switch (item.fileType) {
      case 'audio': return '#6C5CE7'; case 'pdf': return '#FF3B30'; case 'document': return '#3478F6'; case 'archive': return '#8E8E93'; case 'apk': return '#34C759'; default: return '#0A7EA4';
    }
  };

  return (
    <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
      <View style={styles.previewContainer}>
        {isVisual ? (
          <View style={styles.imageWrapper}>
            <Image source={{ uri: item.uri }} style={styles.image} contentFit="cover" transition={200} />
            {isVideo && <View style={styles.videoOverlay}><View style={styles.playButton}><MaterialIcons name="play-arrow" size={40} color="#FFFFFF" style={{ marginLeft: 4 }} /></View>{item.duration ? <View style={styles.durationBadge}><Text style={styles.durationText}>{item.duration}</Text></View> : null}</View>}
          </View>
        ) : isPdf && pdfThumbnail ? (
          <View style={styles.imageWrapper}><View style={styles.pdfThumbnailBackground}><Image source={{ uri: pdfThumbnail }} style={styles.pdfThumbnail} contentFit="contain" /></View></View>
        ) : isOffice ? (
          <View style={styles.officeThumbnailWrapper}><DocumentPreview key={`office-thumb-${item.id}-${item.uri}`} item={item} thumbnail /></View>
        ) : (
          <View style={[styles.genericPreview, { backgroundColor: isDark ? '#202124' : '#F2F2F7' }]}>
            {isPdf && pdfLoading ? <ActivityIndicator size="large" color="#0A7EA4" /> : <View style={[styles.genericIconCircle, { backgroundColor: getGenericColor() }]}><MaterialIcons name={getFileIcon() as any} size={52} color="#FFFFFF" /></View>}
            {!isPdf || !pdfLoading ? <Text style={[styles.genericTypeLabel, { color: isDark ? '#FFFFFF' : '#333333' }]}>{isAudio ? 'AUDIO FILE' : isDocument ? item.fileType.toUpperCase() : item.fileType.toUpperCase()}</Text> : null}
            {isAudio && <View style={styles.audioHint}><MaterialIcons name="play-circle-outline" size={18} color="#6C5CE7" /><Text style={styles.audioHintText}>Tap to preview</Text></View>}
            {item.duration && !isAudio ? <View style={styles.durationBadge}><Text style={styles.durationText}>{item.duration}</Text></View> : null}
          </View>
        )}
        <View style={[styles.sourceBadge, { backgroundColor: getSourceBadgeColor(item.source) }]}><Text style={styles.sourceText}>{item.source}</Text></View>
        <View style={[styles.typeOverlay, isDark ? styles.typeOverlayDark : styles.typeOverlayLight]}><MaterialIcons name={getFileIcon() as any} size={16} color={isDark ? '#FFF' : '#333'} /></View>
        {isTop ? <View style={styles.inspectPrompt}><MaterialIcons name="visibility" size={14} color="#FFF" /><Text style={styles.inspectText}>Tap to full inspect</Text></View> : null}
      </View>
      <View style={styles.infoContainer}><View style={styles.nameRow}><ThemedText type="defaultSemiBold" style={styles.fileName} numberOfLines={1}>{item.fileName}</ThemedText></View><View style={styles.metaGrid}><View style={styles.metaColumn}><Text style={[styles.metaLabel, isDark ? styles.labelDark : styles.labelLight]}>SIZE</Text><ThemedText type="defaultSemiBold" style={styles.metaValue}>{formatFileSize(item.fileSize)}</ThemedText></View><View style={[styles.divider, { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' }]} /><View style={styles.metaColumn}><Text style={[styles.metaLabel, isDark ? styles.labelDark : styles.labelLight]}>CREATED</Text><ThemedText type="defaultSemiBold" style={styles.metaValue}>{formatDate(item.dateCreated)}</ThemedText></View></View></View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, overflow: 'hidden', height: '100%', width: '100%', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 }, cardLight: { backgroundColor: '#FFFFFF', shadowColor: '#000000', borderWidth: 1, borderColor: '#E5E5EA' }, cardDark: { backgroundColor: '#1C1C1E', shadowColor: '#000000', borderWidth: 1, borderColor: '#2C2C2E' }, previewContainer: { flex: 1, position: 'relative', overflow: 'hidden' }, imageWrapper: { width: '100%', height: '100%' }, officeThumbnailWrapper: { width: '100%', height: '100%', overflow: 'hidden' }, image: { width: '100%', height: '100%' }, pdfThumbnailBackground: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, pdfThumbnail: { width: '100%', height: '100%' }, genericPreview: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', padding: 24 }, genericIconCircle: { width: 110, height: 110, borderRadius: 55, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4, marginBottom: 18 }, genericTypeLabel: { fontSize: 15, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12 }, audioHint: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(108, 92, 231, 0.1)' }, audioHintText: { color: '#6C5CE7', fontSize: 11, fontWeight: '700' }, videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.15)', justifyContent: 'center', alignItems: 'center' }, playButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFFFFF' }, durationBadge: { position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(0, 0, 0, 0.75)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }, durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' }, sourceBadge: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 }, sourceText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }, typeOverlay: { position: 'absolute', top: 14, right: 14, width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 }, typeOverlayLight: { backgroundColor: 'rgba(255, 255, 255, 0.9)' }, typeOverlayDark: { backgroundColor: 'rgba(28, 28, 30, 0.9)' }, infoContainer: { paddingHorizontal: 18, paddingVertical: 16 }, nameRow: { marginBottom: 10 }, fileName: { fontSize: 16, fontWeight: '700' }, metaGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }, metaColumn: { flex: 1 }, metaLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2, marginBottom: 4 }, labelLight: { color: '#8E8E93' }, labelDark: { color: '#636366' }, metaValue: { fontSize: 14, fontWeight: '600' }, divider: { width: 1, height: 28, marginHorizontal: 16 }, inspectPrompt: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, zIndex: 20 }, inspectText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
});