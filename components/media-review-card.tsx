import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, Modal, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useSharedValue, useAnimatedStyle, withTiming, runOnJS, interpolate, Extrapolation } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setIsAudioActiveAsync } from 'expo-audio';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { MediaPreviewContainer } from './media-preview-container';
import { DocumentPreview } from './document-preview';

export interface MediaReviewCardRef { swipeLeft: () => void; swipeRight: () => void; }
interface MediaReviewCardProps {
  items: MockMediaItem[];
  onSwipeLeft: (item: MockMediaItem) => void | Promise<void>;
  onSwipeRight: (item: MockMediaItem) => void | Promise<void>;
  onUndo?: () => void | Promise<void>;
  isDark?: boolean;
}

const VideoPlayerView = ({ uri, style }: { uri: string; style?: any }) => {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView style={style} player={player} allowsFullscreen allowsPictureInPicture />;
};

const FullscreenAudioPreview = ({ uri }: { uri: string }) => {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [timelineWidth, setTimelineWidth] = useState(0);

  useEffect(() => {
    setIsAudioActiveAsync(true).catch(() => {});
    player.play();
    return () => { setIsAudioActiveAsync(false).catch(() => {}); };
  }, [player]);

  const togglePlayback = () => {
    if (status.playing) { player.pause(); return; }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) player.seekTo(0);
    setIsAudioActiveAsync(true).catch(() => {});
    player.play();
  };
  const seekBy = (seconds: number) => {
    if (status.duration <= 0) return;
    player.seekTo(Math.max(0, Math.min(status.duration, status.currentTime + seconds)));
  };
  const seekToPosition = (locationX: number) => {
    if (status.duration <= 0 || timelineWidth <= 0) return;
    player.seekTo(status.duration * Math.max(0, Math.min(1, locationX / timelineWidth)));
  };
  const progress = status.duration > 0 ? Math.min(1, Math.max(0, status.currentTime / status.duration)) : 0;

  return <View style={styles.audioPreview}>
    <View style={styles.audioIconCircle}><MaterialIcons name="audiotrack" size={72} color="#FFFFFF" /></View>
    <Text style={styles.audioLabel}>AUDIO FILE</Text>
    <View style={styles.audioControlsRow}>
      <TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(-10)}><MaterialIcons name="replay-10" size={30} color="#FFFFFF" /></TouchableOpacity>
      <TouchableOpacity style={styles.audioPlayButton} onPress={togglePlayback}><MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={42} color="#FFFFFF" /></TouchableOpacity>
      <TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(10)}><MaterialIcons name="forward-10" size={30} color="#FFFFFF" /></TouchableOpacity>
    </View>
    <TouchableOpacity style={styles.audioTimeline} onLayout={e => setTimelineWidth(e.nativeEvent.layout.width)} onPress={e => seekToPosition(e.nativeEvent.locationX)}>
      <View style={styles.audioTrack}><View style={styles.audioProgress} /><View style={styles.audioThumb} /></View>
      <View style={styles.audioTimeRow}><Text style={styles.audioTime}>{formatTime(status.currentTime)}</Text><Text style={styles.audioTime}>{formatTime(status.duration)}</Text></View>
    </TouchableOpacity>
  </View>;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export const MediaReviewCard = forwardRef<MediaReviewCardRef, MediaReviewCardProps>(({ items, onSwipeLeft, onSwipeRight, onUndo }, ref) => {
  const { width: screenWidth } = useWindowDimensions();
  const threshold = screenWidth * 0.35;
  const item = items[0];
  const nextItem = items[1];
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    setPreviewItemId(null);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    translateX.value = 0;
    translateY.value = 0;
  }, [item?.id]);

  useImperativeHandle(ref, () => ({
    swipeLeft: () => { if (!item) return; cancelAnimation(translateX); cancelAnimation(translateY); translateX.value = withTiming(-screenWidth * 1.5, { duration: 220 }, finished => { if (finished) runOnJS(onSwipeLeft)(item); }); translateY.value = withTiming(0, { duration: 160 }); },
    swipeRight: () => { if (!item) return; cancelAnimation(translateX); cancelAnimation(translateY); translateX.value = withTiming(screenWidth * 1.5, { duration: 220 }, finished => { if (finished) runOnJS(onSwipeRight)(item); }); translateY.value = withTiming(0, { duration: 160 }); },
  }), [item, onSwipeLeft, onSwipeRight, screenWidth]);

  if (!item) return null;

  const animateSwipe = (direction: 'left' | 'right') => {
    const target = direction === 'right' ? screenWidth * 1.5 : -screenWidth * 1.5;
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    translateX.value = withTiming(target, { duration: 220 }, finished => {
      if (finished) runOnJS(direction === 'right' ? onSwipeRight : onSwipeLeft)(item);
    });
    translateY.value = withTiming(0, { duration: 160 });
  };

  const panGesture = Gesture.Pan()
    .onBegin(() => { cancelAnimation(translateX); cancelAnimation(translateY); })
    .onUpdate(e => { translateX.value = e.translationX; translateY.value = e.translationY; })
    .onEnd(e => {
      if (e.translationX > threshold) {
        translateX.value = withTiming(screenWidth * 1.5, { duration: 220 }, finished => { if (finished) runOnJS(onSwipeRight)(item); });
        translateY.value = withTiming(0, { duration: 160 });
      } else if (e.translationX < -threshold) {
        translateX.value = withTiming(-screenWidth * 1.5, { duration: 220 }, finished => { if (finished) runOnJS(onSwipeLeft)(item); });
        translateY.value = withTiming(0, { duration: 160 });
      } else {
        translateX.value = withTiming(0, { duration: 160 });
        translateY.value = withTiming(0, { duration: 160 });
      }
    });
  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(setPreviewItemId)(item.id));
  const gesture = Gesture.Exclusive(panGesture, tapGesture);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${interpolate(translateX.value, [-screenWidth, 0, screenWidth], [-12, 0, 12], Extrapolation.CLAMP)}deg` }] }));
  const keepBadge = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [0, threshold * 0.7], [0, 1], Extrapolation.CLAMP) }));
  const deleteBadge = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [-threshold * 0.7, 0], [1, 0], Extrapolation.CLAMP) }));

  const isDocument = item.category === 'document' || item.fileType === 'document' || item.fileType === 'pdf';
  const isPreviewVisible = previewItemId === item.id;

  return <View style={styles.reviewContainer}>
    <View style={styles.stackContainer}>
      <GestureDetector gesture={gesture}>
        <View style={styles.gestureContainer}>
          {nextItem ? <View style={[styles.cardWrapper, styles.backCard]}><MediaPreviewContainer key={`back-${nextItem.id}`} item={nextItem} isTop={false} /></View> : null}
          <Animated.View style={[styles.cardWrapper, cardStyle]}>
            <MediaPreviewContainer key={`front-${item.id}`} item={item} isTop />
            <Animated.View style={[styles.badgeContainer, styles.keepBadge, keepBadge]}><Text style={styles.badgeText}>KEEP</Text></Animated.View>
            <Animated.View style={[styles.badgeContainer, styles.deleteBadge, deleteBadge]}><Text style={styles.badgeText}>DELETE</Text></Animated.View>
            <Modal key={`preview-${item.id}`} visible={isPreviewVisible} animationType="slide" onRequestClose={() => setPreviewItemId(null)}>
              <View style={styles.modalContainer}>
                <View style={styles.modalHeader}><View style={styles.modalMeta}><Text style={styles.modalTitle} numberOfLines={1}>{item.fileName}</Text><Text style={styles.modalSubtitle}>{(item.fileSize / (1024 * 1024)).toFixed(2)} MB</Text></View><TouchableOpacity style={styles.closeButton} onPress={() => setPreviewItemId(null)}><MaterialIcons name="close" size={26} color="#FFFFFF" /></TouchableOpacity></View>
                <View style={styles.modalContent}>
                  {item.fileType === 'video' ? <VideoPlayerView key={`video-${item.id}`} uri={item.uri} style={styles.fullVideo} /> : item.fileType === 'audio' ? <FullscreenAudioPreview key={`audio-${item.id}`} uri={item.uri} /> : isDocument ? <DocumentPreview key={`document-${item.id}-${item.uri}`} item={item} /> : <Image key={`image-${item.id}-${item.uri}`} source={{ uri: item.uri }} style={styles.fullImage} contentFit="contain" />}
                </View>
              </View>
            </Modal>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
    <View style={styles.actionBar}>
      <TouchableOpacity style={[styles.actionButton, styles.deleteAction]} onPress={() => animateSwipe('left')}><MaterialIcons name="close" size={30} color="#FFFFFF" /></TouchableOpacity>
      <TouchableOpacity style={[styles.actionButton, styles.undoAction]} onPress={() => onUndo?.()}><MaterialIcons name="undo" size={25} color="#FFFFFF" /></TouchableOpacity>
      <TouchableOpacity style={[styles.actionButton, styles.keepAction]} onPress={() => animateSwipe('right')}><MaterialIcons name="check" size={30} color="#FFFFFF" /></TouchableOpacity>
    </View>
  </View>;
});

MediaReviewCard.displayName = 'MediaReviewCard';

const styles = StyleSheet.create({
  reviewContainer: { flex: 1, width: '100%', alignItems: 'center', minHeight: 0 },
  stackContainer: { flex: 1, width: '100%', minHeight: 0, justifyContent: 'center', alignItems: 'center' },
  gestureContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  cardWrapper: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  backCard: { transform: [{ scale: 0.96 }, { translateY: 10 }], opacity: 0.9 },
  badgeContainer: { position: 'absolute', top: 35, borderWidth: 4, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 5, zIndex: 10 },
  keepBadge: { left: 45, borderColor: '#34C759', backgroundColor: 'rgba(52,199,89,0.9)', transform: [{ rotate: '-15deg' }] },
  deleteBadge: { right: 45, borderColor: '#FF3B30', backgroundColor: 'rgba(255,59,48,0.9)', transform: [{ rotate: '15deg' }] },
  badgeText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: 2 },
  actionBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, paddingTop: 6, paddingBottom: 10, zIndex: 30 },
  actionButton: { width: 58, height: 58, borderRadius: 29, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  deleteAction: { backgroundColor: '#FF3B30' }, undoAction: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#687076' }, keepAction: { backgroundColor: '#34C759' },
  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 15, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10 },
  modalMeta: { flex: 1, marginRight: 15 }, modalTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, modalSubtitle: { color: '#B0B0B0', fontSize: 12, marginTop: 3 },
  closeButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { flex: 1, justifyContent: 'center', alignItems: 'center' }, fullImage: { width: '100%', height: '100%' }, fullVideo: { width: '100%', height: '100%' },
  audioPreview: { width: '88%', alignItems: 'center', justifyContent: 'center' }, audioIconCircle: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }, audioLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginBottom: 28 },
  audioControlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 }, audioSkipButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(108,92,231,0.85)', justifyContent: 'center', alignItems: 'center' }, audioPlayButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center' },
  audioTimeline: { width: '100%', paddingVertical: 8 }, audioTrack: { height: 6, borderRadius: 3, backgroundColor: '#444444', position: 'relative' }, audioProgress: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF', width: '50%' }, audioThumb: { position: 'absolute', top: -5, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF', left: '50%' }, audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }, audioTime: { color: '#B0B0B0', fontSize: 12 },
});