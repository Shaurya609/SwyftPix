import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, Modal, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolation } from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus, setIsAudioActiveAsync } from 'expo-audio';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { MediaPreviewContainer } from './media-preview-container';

export interface MediaReviewCardRef { swipeLeft: () => void; swipeRight: () => void; }
interface MediaReviewCardProps {
  items: MockMediaItem[];
  onSwipeLeft: (item: MockMediaItem) => void | Promise<void>;
  onSwipeRight: (item: MockMediaItem) => void | Promise<void>;
  onUndo?: () => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  isDark?: boolean;
}
interface VideoPlayerViewProps { uri: string; style?: any; }

const VideoPlayerView = ({ uri, style }: VideoPlayerViewProps) => {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return <VideoView style={style} player={player} allowsFullscreen allowsPictureInPicture />;
};

const FullscreenAudioPreview = ({ uri }: { uri: string }) => {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [timelineWidth, setTimelineWidth] = useState(0);

  useEffect(() => {
    setIsAudioActiveAsync(true).catch((error) => console.warn('[AudioPreview] Unable to activate audio:', error));
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
    if (!status.duration) return;
    player.seekTo(Math.max(0, Math.min(status.duration, status.currentTime + seconds)));
  };

  const seekToPosition = (locationX: number) => {
    if (!status.duration || timelineWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / timelineWidth));
    player.seekTo(status.duration * ratio);
  };

  const progress = status.duration > 0 ? Math.min(1, Math.max(0, status.currentTime / status.duration)) : 0;

  return (
    <View style={styles.audioPreview}>
      <View style={styles.audioIconCircle}><MaterialIcons name="audiotrack" size={72} color="#FFFFFF" /></View>
      <Text style={styles.audioLabel}>AUDIO FILE</Text>
      <View style={styles.audioControlsRow}>
        <TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(-10)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Back 10 seconds"><MaterialIcons name="replay-10" size={30} color="#FFFFFF" /></TouchableOpacity>
        <TouchableOpacity style={styles.audioPlayButton} onPress={togglePlayback} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}><MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={42} color="#FFFFFF" style={status.playing ? undefined : { marginLeft: 3 }} /></TouchableOpacity>
        <TouchableOpacity style={styles.audioSkipButton} onPress={() => seekBy(10)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Forward 10 seconds"><MaterialIcons name="forward-10" size={30} color="#FFFFFF" /></TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.audioTimeline} activeOpacity={1} onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)} onPress={(event) => seekToPosition(event.nativeEvent.locationX)} accessibilityRole="adjustable" accessibilityLabel="Audio timeline">
        <View style={styles.audioTrack}>
          <View style={[styles.audioProgress, { width: `${progress * 100}%` }]} />
          <View style={[styles.audioThumb, { left: `${progress * 100}%` }]} />
        </View>
        <View style={styles.audioTimeRow}><Text style={styles.audioTime}>{formatTime(status.currentTime)}</Text><Text style={styles.audioTime}>{formatTime(status.duration)}</Text></View>
      </TouchableOpacity>
    </View>
  );
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${(wholeSeconds % 60).toString().padStart(2, '0')}`;
}

export const MediaReviewCard = forwardRef<MediaReviewCardRef, MediaReviewCardProps>(({ items, onSwipeLeft, onSwipeRight, onUndo, onReset }, ref) => {
  const { width: screenWidth } = useWindowDimensions();
  const SWIPE_THRESHOLD = screenWidth * 0.35;
  const item = items[0]!;
  const nextItem = items[1];
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const maxRotation = 12;

  useImperativeHandle(ref, () => ({
    swipeLeft: () => { translateX.value = withTiming(-screenWidth * 1.5, { duration: 300 }, () => runOnJS(onSwipeLeft)(item)); },
    swipeRight: () => { translateX.value = withTiming(screenWidth * 1.5, { duration: 300 }, () => runOnJS(onSwipeRight)(item)); },
  }), [item, onSwipeLeft, onSwipeRight, screenWidth]);

  const animateSwipe = (direction: 'left' | 'right') => {
    const target = direction === 'right' ? screenWidth * 1.5 : -screenWidth * 1.5;
    translateX.value = withTiming(target, { duration: 250 }, () => {
      if (direction === 'right') runOnJS(onSwipeRight)(item);
      else runOnJS(onSwipeLeft)(item);
    });
  };

  const panGesture = Gesture.Pan().enabled(!!item).onUpdate((event) => { translateX.value = event.translationX; translateY.value = event.translationY; }).onEnd((event) => {
    if (event.translationX > SWIPE_THRESHOLD) translateX.value = withSpring(screenWidth * 1.5, { velocity: Math.max(event.velocityX, 800) }, () => runOnJS(onSwipeRight)(item));
    else if (event.translationX < -SWIPE_THRESHOLD) translateX.value = withSpring(-screenWidth * 1.5, { velocity: Math.min(event.velocityX, -800) }, () => runOnJS(onSwipeLeft)(item));
    else { translateX.value = withSpring(0, { damping: 15 }); translateY.value = withSpring(0, { damping: 15 }); }
  });

  const animatedCardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${interpolate(translateX.value, [-screenWidth, 0, screenWidth], [-maxRotation, 0, maxRotation], Extrapolation.CLAMP)}deg` }] }));
  const animatedKeepBadgeStyle = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD * 0.7], [0, 1], Extrapolation.CLAMP) }));
  const animatedDeleteBadgeStyle = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD * 0.7, 0], [1, 0], Extrapolation.CLAMP) }));

  const closePreview = () => setIsPreviewVisible(false);
  const handlePress = async () => {
    const isRemote = item.uri.startsWith('http://') || item.uri.startsWith('https://');
    if (isRemote) {
      try { await WebBrowser.openBrowserAsync(item.uri, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC }); }
      catch (error) { console.error('Error opening preview:', error); }
    } else setIsPreviewVisible(true);
  };

  const tapGesture = Gesture.Tap().enabled(!!item).onEnd(() => runOnJS(handlePress)());
  const combinedGesture = Gesture.Exclusive(panGesture, tapGesture);

  if (!item) return null;

  return (
    <View style={styles.reviewContainer}>
      <GestureDetector gesture={combinedGesture}>
        <View style={styles.stackContainer}>
          {nextItem ? (
            <View style={[styles.cardWrapper, styles.backCard]}><MediaPreviewContainer item={nextItem} isTop={false} /></View>
          ) : null}
          <Animated.View style={[styles.cardWrapper, animatedCardStyle]}>
            <MediaPreviewContainer item={item} isTop />
            <Animated.View style={[styles.badgeContainer, styles.keepBadge, animatedKeepBadgeStyle]}><Text style={styles.keepText}>KEEP</Text></Animated.View>
            <Animated.View style={[styles.badgeContainer, styles.deleteBadge, animatedDeleteBadgeStyle]}><Text style={styles.deleteText}>DELETE</Text></Animated.View>
            <Modal visible={isPreviewVisible} transparent={false} animationType="slide" onRequestClose={closePreview}>
              <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalMeta}><Text style={styles.modalTitle} numberOfLines={1}>{item.fileName}</Text><Text style={styles.modalSubtitle}>{(item.fileSize / (1024 * 1024)).toFixed(2)} MB</Text></View>
                  <TouchableOpacity style={styles.closeButton} onPress={closePreview} activeOpacity={0.7}><MaterialIcons name="close" size={26} color="#FFFFFF" /></TouchableOpacity>
                </View>
                <View style={styles.modalContent}>
                  {item.fileType === 'video' ? <VideoPlayerView uri={item.uri} style={styles.fullVideo} /> : item.fileType === 'audio' ? <FullscreenAudioPreview uri={item.uri} /> : <Image source={{ uri: item.uri }} style={styles.fullImage} contentFit="contain" />}
                </View>
              </View>
            </Modal>
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.actionButton, styles.deleteAction]} onPress={() => animateSwipe('left')} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Move to trash">
          <MaterialIcons name="close" size={30} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.undoAction]} onPress={() => onUndo?.()} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Undo last action">
          <MaterialIcons name="undo" size={25} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.keepAction]} onPress={() => animateSwipe('right')} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Keep this item">
          <MaterialIcons name="check" size={30} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      {onReset ? <TouchableOpacity style={styles.resetAction} onPress={() => onReset()} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Reset review">
        <MaterialIcons name="refresh" size={18} color="#687076" /><Text style={styles.resetActionText}>Reset</Text>
      </TouchableOpacity> : null}
    </View>
  );
});

MediaReviewCard.displayName = 'MediaReviewCard';

const styles = StyleSheet.create({
  reviewContainer: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stackContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  cardWrapper: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  backCard: { transform: [{ scale: 0.96 }, { translateY: 10 }], opacity: 0.9 },
  badgeContainer: { position: 'absolute', top: 35, borderWidth: 4, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 5, zIndex: 10, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
  keepBadge: { left: 45, borderColor: '#34C759', transform: [{ rotate: '-15deg' }], backgroundColor: 'rgba(52, 199, 89, 0.9)' },
  deleteBadge: { right: 45, borderColor: '#FF3B30', transform: [{ rotate: '15deg' }], backgroundColor: 'rgba(255, 59, 48, 0.9)' },
  keepText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2 },
  deleteText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2 },
  actionBar: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, zIndex: 30, elevation: 30 },
  actionButton: { width: 58, height: 58, borderRadius: 29, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 4 },
  deleteAction: { backgroundColor: '#FF3B30' },
  undoAction: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#687076' },
  keepAction: { backgroundColor: '#34C759' },
  resetAction: { position: 'absolute', bottom: 76, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, zIndex: 30 },
  resetActionText: { color: '#687076', fontSize: 13, fontWeight: '600' },
  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 15, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 10 },
  modalMeta: { flex: 1, marginRight: 15 },
  modalTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  modalSubtitle: { color: '#B0B0B0', fontSize: 12, marginTop: 3 },
  closeButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullImage: { width: '100%', height: '100%' },
  fullVideo: { width: '100%', height: '100%' },
  audioPreview: { width: '88%', alignItems: 'center', justifyContent: 'center' },
  audioIconCircle: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  audioLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginBottom: 28 },
  audioControlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 },
  audioSkipButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(108, 92, 231, 0.85)', justifyContent: 'center', alignItems: 'center' },
  audioPlayButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center' },
  audioTimeline: { width: '100%', paddingVertical: 8 },
  audioTrack: { height: 7, borderRadius: 4, overflow: 'visible', backgroundColor: 'rgba(255, 255, 255, 0.25)', position: 'relative' },
  audioProgress: { height: '100%', borderRadius: 4, backgroundColor: '#FFFFFF' },
  audioThumb: { position: 'absolute', top: -4, marginLeft: -6, width: 15, height: 15, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#6C5CE7' },
  audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  audioTime: { color: '#B0B0B0', fontSize: 12, fontWeight: '600' },
});