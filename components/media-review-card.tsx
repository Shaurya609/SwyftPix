import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, Modal, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolation } from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { MediaPreviewContainer } from './media-preview-container';

export interface MediaReviewCardRef { swipeLeft: () => void; swipeRight: () => void; }
interface MediaReviewCardProps { item: MockMediaItem; onSwipeLeft: () => void; onSwipeRight: () => void; isTop: boolean; style?: any; }
interface VideoPlayerViewProps { uri: string; style?: any; }

const VideoPlayerView = ({ uri, style }: VideoPlayerViewProps) => {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return <VideoView style={style} player={player} allowsFullscreen allowsPictureInPicture />;
};

const FullscreenAudioPreview = ({ uri }: { uri: string }) => {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    player.play();
    return () => {
      player.pause();
      player.remove();
    };
  }, [player]);

  const togglePlayback = () => {
    if (status.playing) { player.pause(); return; }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) player.seekTo(0);
    player.play();
  };

  const progress = status.duration > 0 ? Math.min(1, Math.max(0, status.currentTime / status.duration)) : 0;

  return (
    <View style={styles.audioPreview}>
      <View style={styles.audioIconCircle}><MaterialIcons name="audiotrack" size={72} color="#FFFFFF" /></View>
      <Text style={styles.audioLabel}>AUDIO FILE</Text>
      <TouchableOpacity style={styles.audioPlayButton} onPress={togglePlayback} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}>
        <MaterialIcons name={status.playing ? 'pause' : 'play-arrow'} size={42} color="#FFFFFF" style={status.playing ? undefined : { marginLeft: 3 }} />
      </TouchableOpacity>
      <View style={styles.audioTimeline}>
        <View style={styles.audioTrack}><View style={[styles.audioProgress, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.audioTimeRow}><Text style={styles.audioTime}>{formatTime(status.currentTime)}</Text><Text style={styles.audioTime}>{formatTime(status.duration)}</Text></View>
      </View>
    </View>
  );
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${(wholeSeconds % 60).toString().padStart(2, '0')}`;
}

export const MediaReviewCard = forwardRef<MediaReviewCardRef, MediaReviewCardProps>(({ item, onSwipeLeft, onSwipeRight, isTop, style }, ref) => {
  const { width: screenWidth } = useWindowDimensions();
  const SWIPE_THRESHOLD = screenWidth * 0.35;
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const maxRotation = 12;

  useImperativeHandle(ref, () => ({
    swipeLeft: () => { translateX.value = withTiming(-screenWidth * 1.5, { duration: 300 }, () => runOnJS(onSwipeLeft)()); },
    swipeRight: () => { translateX.value = withTiming(screenWidth * 1.5, { duration: 300 }, () => runOnJS(onSwipeRight)()); },
  }));

  const panGesture = Gesture.Pan().enabled(isTop).onUpdate((event) => {
    translateX.value = event.translationX; translateY.value = event.translationY;
  }).onEnd((event) => {
    if (event.translationX > SWIPE_THRESHOLD) {
      translateX.value = withSpring(screenWidth * 1.5, { velocity: Math.max(event.velocityX, 800) }, () => runOnJS(onSwipeRight)());
    } else if (event.translationX < -SWIPE_THRESHOLD) {
      translateX.value = withSpring(-screenWidth * 1.5, { velocity: Math.min(event.velocityX, -800) }, () => runOnJS(onSwipeLeft)());
    } else {
      translateX.value = withSpring(0, { damping: 15 }); translateY.value = withSpring(0, { damping: 15 });
    }
  });

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${interpolate(translateX.value, [-screenWidth, 0, screenWidth], [-maxRotation, 0, maxRotation], Extrapolation.CLAMP)}deg` },
    ],
  }));
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

  const tapGesture = Gesture.Tap().enabled(isTop).onEnd(() => runOnJS(handlePress)());
  const combinedGesture = Gesture.Exclusive(panGesture, tapGesture);

  return (
    <GestureDetector gesture={combinedGesture}>
      <Animated.View style={[styles.cardWrapper, style, isTop && animatedCardStyle]}>
        <MediaPreviewContainer item={item} isTop={isTop} />
        {isTop && <>
          <Animated.View style={[styles.badgeContainer, styles.keepBadge, animatedKeepBadgeStyle]}><Text style={styles.keepText}>KEEP</Text></Animated.View>
          <Animated.View style={[styles.badgeContainer, styles.deleteBadge, animatedDeleteBadgeStyle]}><Text style={styles.deleteText}>DELETE</Text></Animated.View>
        </>}

        <Modal visible={isPreviewVisible} transparent={false} animationType="slide" onRequestClose={closePreview}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalMeta}>
                <Text style={styles.modalTitle} numberOfLines={1}>{item.fileName}</Text>
                <Text style={styles.modalSubtitle}>{(item.fileSize / (1024 * 1024)).toFixed(2)} MB</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={closePreview} activeOpacity={0.7}><MaterialIcons name="close" size={26} color="#FFFFFF" /></TouchableOpacity>
            </View>
            <View style={styles.modalContent}>
              {item.fileType === 'video' ? <VideoPlayerView uri={item.uri} style={styles.fullVideo} /> : item.fileType === 'audio' ? <FullscreenAudioPreview uri={item.uri} /> : <Image source={{ uri: item.uri }} style={styles.fullImage} contentFit="contain" />}
            </View>
          </View>
        </Modal>
      </Animated.View>
    </GestureDetector>
  );
});

MediaReviewCard.displayName = 'MediaReviewCard';

const styles = StyleSheet.create({
  cardWrapper: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  badgeContainer: { position: 'absolute', top: 35, borderWidth: 4, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 5, zIndex: 10, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
  keepBadge: { left: 45, borderColor: '#34C759', transform: [{ rotate: '-15deg' }], backgroundColor: 'rgba(52, 199, 89, 0.9)' },
  deleteBadge: { right: 45, borderColor: '#FF3B30', transform: [{ rotate: '15deg' }], backgroundColor: 'rgba(255, 59, 48, 0.9)' },
  keepText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2 },
  deleteText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2 },
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
  audioPlayButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#6C5CE7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  audioTimeline: { width: '100%' },
  audioTrack: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.25)' },
  audioProgress: { height: '100%', borderRadius: 3, backgroundColor: '#FFFFFF' },
  audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  audioTime: { color: '#B0B0B0', fontSize: 12, fontWeight: '600' },
});