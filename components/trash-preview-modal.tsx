import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setIsAudioActiveAsync } from 'expo-audio';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TrashedAsset } from '@/types/media';
import { DocumentPreview } from './document-preview';
import { PptxPreview } from './pptx-preview';
import { formatDate, formatFileSize } from '@/utils/formatters';

interface TrashPreviewModalProps {
  item: TrashedAsset | null;
  visible: boolean;
  onClose: () => void;
  onRestore: (item: TrashedAsset) => void | Promise<void>;
  onDelete: (item: TrashedAsset) => void | Promise<void>;
  isProcessing?: boolean;
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView style={styles.fullMedia} player={player} allowsFullscreen allowsPictureInPicture />;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, '0')}`;
}

function AudioPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [timelineWidth, setTimelineWidth] = useState(0);
  useEffect(() => { setIsAudioActiveAsync(true).catch(() => {}); player.play(); return () => { setIsAudioActiveAsync(false).catch(() => {}); }; }, [player]);
  const togglePlayback = () => { if (status.playing) { player.pause(); return; } if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) player.seekTo(0); setIsAudioActiveAsync(true).catch(() => {}); player.play(); };
  const seekBy = (seconds: number) => { if (status.duration <= 0) return; player.seekTo(Math.max(0, Math.min(status.duration, status.currentTime + seconds))); };
  const seekToPosition = (locationX: number) => { if (status.duration <= 0 || timelineWidth <= 0) return; player.seekTo(status.duration * Math.max(0, Math.min(1, locationX / timelineWidth))); };
  const progress = status.duration > 0 ? Math.min(1, Math.max(0, status.currentTime / status.duration)) : 0;
  return <View style={styles.audioPreview}><View style={styles.audioIconCircle}><MaterialIcons name="audiotrack" size={72} color="#FFFFFF" /></View><Text style={styles.typeLabel}>AUDIO FILE</Text><View style={styles.audioControlsRow}><TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(-10)}><MaterialIcons name="replay-10" size={30} color="#FFFFFF" /></TouchableOpacity><TouchableOpacity style={styles.audioPlayButton} onPress={togglePlayback}><MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={42} color="#FFFFFF" /></TouchableOpacity><TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(10)}><MaterialIcons name="forward-10" size={30} color="#FFFFFF" /></TouchableOpacity></View><TouchableOpacity style={styles.audioTimeline} onLayout={e => setTimelineWidth(e.nativeEvent.layout.width)} onPress={e => seekToPosition(e.nativeEvent.locationX)}><View style={styles.audioTrack}><View style={[styles.audioProgress, { width: `${progress * 100}%` }]} /><View style={[styles.audioThumb, { left: `${progress * 100}%` }]} /></View><View style={styles.audioTimeRow}><Text style={styles.audioTime}>{formatTime(status.currentTime)}</Text><Text style={styles.audioTime}>{formatTime(status.duration)}</Text></View></TouchableOpacity></View>;
}

function isDocument(item: TrashedAsset) {
  return item.category === 'document' || item.fileType === 'document' || item.fileType === 'pdf' || item.mimeType?.toLowerCase() === 'application/pdf';
}

export function TrashPreviewModal({ item, visible, onClose, onRestore, onDelete, isProcessing = false }: TrashPreviewModalProps) {
  if (!item) return null;
  const handleDelete = () => Alert.alert('Delete permanently?', `“${item.fileName}” will be permanently deleted from your device. This cannot be undone.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete Permanently', style: 'destructive', onPress: () => onDelete(item) }]);
  const isPptx = item.fileName.toLowerCase().endsWith('.pptx');
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}><View style={styles.meta}><Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text><Text style={styles.subtitle}>{formatFileSize(item.fileSize)} • {formatDate(item.dateCreated)}</Text></View><TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={isProcessing}><MaterialIcons name="close" size={26} color="#FFFFFF" /></TouchableOpacity></View>
        <View style={styles.content}>
          {item.fileType === 'video' ? <VideoPreview key={`video-${item.id}`} uri={item.uri}`} />
            : item.fileType === 'audio' ? <AudioPreview key={`audio-${item.id}`} uri={item.uri} />
            : isPptx ? <PptxPreview key={`pptx-${item.id}-${item.uri}`} item={item} />
            : isDocument(item) ? <DocumentPreview key={`document-${item.id}-${item.uri}`} item={item} />
            : <Image key={`image-${item.id}-${item.uri}`} source={{ uri: item.uri }} style={styles.fullMedia} contentFit="contain" />}
        </View>
        <View style={styles.actionBar}><TouchableOpacity style={[styles.action, styles.restoreAction]} onPress={() => onRestore(item)} disabled={isProcessing}><MaterialIcons name="restore" size={21} color="#FFFFFF" /><Text style={styles.actionText}>Restore</Text></TouchableOpacity><TouchableOpacity style={[styles.action, styles.deleteAction]} onPress={handleDelete} disabled={isProcessing}><MaterialIcons name="delete-forever" size={21} color="#FFFFFF" /><Text style={styles.actionText}>Delete Permanently</Text></TouchableOpacity></View>
        {isProcessing && <View style={styles.processing}><ActivityIndicator size="small" color="#FFFFFF" /></View>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 50, paddingBottom: 14, backgroundColor: '#080808', zIndex: 10 }, meta: { flex: 1, marginRight: 14 }, fileName: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, subtitle: { color: '#A0A0A0', fontSize: 12, marginTop: 4 }, closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#292929', justifyContent: 'center', alignItems: 'center' }, content: { flex: 1, justifyContent: 'center', alignItems: 'center' }, fullMedia: { width: '100%', height: '100%' }, actionBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, backgroundColor: '#080808' }, action: { flex: 1, minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, restoreAction: { backgroundColor: '#0A7EA4' }, deleteAction: { backgroundColor: '#FF3B30' }, actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, processing: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }, audioPreview: { width: '88%', alignItems: 'center', justifyContent: 'center' }, audioIconCircle: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }, typeLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginBottom: 28 }, audioControlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 }, audioSkipButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(108,92,231,0.85)', justifyContent: 'center', alignItems: 'center' }, audioPlayButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center' }, audioTimeline: { width: '100%', paddingVertical: 8 }, audioTrack: { height: 6, borderRadius: 3, backgroundColor: '#444444', position: 'relative' }, audioProgress: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }, audioThumb: { position: 'absolute', top: -5, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' }, audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }, audioTime: { color: '#B0B0B0', fontSize: 12 },
});