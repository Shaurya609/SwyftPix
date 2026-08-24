import React, { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, Modal, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { DocumentPreview } from './document-preview';

interface Props {
  items: MockMediaItem[];
  onSwipeLeft: (item: MockMediaItem) => void | Promise<void>;
  onSwipeRight: (item: MockMediaItem) => void | Promise<void>;
  onUndo?: () => void | Promise<void>;
  onReset?: () => void | Promise<void>;
}

export function DocumentReviewCard({ items, onSwipeLeft, onSwipeRight, onUndo, onReset }: Props) {
  const { width } = useWindowDimensions();
  const item = items[0];
  const nextItem = items[1];
  const threshold = width * 0.35;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const [previewVisible, setPreviewVisible] = useState(false);

  if (!item) return null;

  const finishSwipe = (direction: 'left' | 'right') => {
    x.value = withTiming(direction === 'right' ? width * 1.5 : -width * 1.5, { duration: 250 }, () => {
      runOnJS(direction === 'right' ? onSwipeRight : onSwipeLeft)(item);
    });
  };

  const pan = Gesture.Pan().onUpdate(event => {
    x.value = event.translationX;
    y.value = event.translationY;
  }).onEnd(event => {
    if (event.translationX > threshold) finishSwipe('right');
    else if (event.translationX < -threshold) finishSwipe('left');
    else {
      x.value = withSpring(0, { damping: 15 });
      y.value = withSpring(0, { damping: 15 });
    }
  });

  const tap = Gesture.Tap().onEnd(() => runOnJS(setPreviewVisible)(true));
  const gesture = Gesture.Exclusive(pan, tap);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${interpolate(x.value, [-width, 0, width], [-10, 0, 10], Extrapolation.CLAMP)}deg` }] }));
  const keepBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, threshold * 0.7], [0, 1], Extrapolation.CLAMP) }));
  const deleteBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-threshold * 0.7, 0], [1, 0], Extrapolation.CLAMP) }));

  return (
    <View style={styles.container}>
      <GestureDetector gesture={gesture}>
        <View style={styles.stack}>
          {nextItem ? <View style={[styles.card, styles.backCard]}><DocumentPreview item={nextItem} /></View> : null}
          <Animated.View style={[styles.card, cardStyle]}>
            <DocumentPreview item={item} />
            <Animated.View style={[styles.badge, styles.keepBadge, keepBadge]}><Text style={styles.badgeText}>KEEP</Text></Animated.View>
            <Animated.View style={[styles.badge, styles.deleteBadge, deleteBadge]}><Text style={styles.badgeText}>DELETE</Text></Animated.View>
            <Modal visible={previewVisible} transparent={false} animationType="slide" onRequestClose={() => setPreviewVisible(false)}>
              <View style={styles.modal}>
                <View style={styles.header}>
                  <Text style={styles.title} numberOfLines={1}>{item.fileName}</Text>
                  <TouchableOpacity style={styles.close} onPress={() => setPreviewVisible(false)} activeOpacity={0.8}><MaterialIcons name="close" size={26} color="#FFFFFF" /></TouchableOpacity>
                </View>
                <DocumentPreview item={item} />
              </View>
            </Modal>
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.delete]} onPress={() => finishSwipe('left')} activeOpacity={0.8}><MaterialIcons name="close" size={30} color="#FFFFFF" /></TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.undo]} onPress={() => onUndo?.()} activeOpacity={0.8}><MaterialIcons name="undo" size={25} color="#FFFFFF" /></TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.keep]} onPress={() => finishSwipe('right')} activeOpacity={0.8}><MaterialIcons name="check" size={30} color="#FFFFFF" /></TouchableOpacity>
      </View>
      {onReset ? <TouchableOpacity style={styles.reset} onPress={() => onReset()} activeOpacity={0.75}><MaterialIcons name="refresh" size={18} color="#687076" /><Text style={styles.resetText}>Reset</Text></TouchableOpacity> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stack: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  card: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  backCard: { transform: [{ scale: 0.96 }, { translateY: 10 }], opacity: 0.9 },
  badge: { position: 'absolute', top: 35, borderWidth: 4, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 5, zIndex: 10 },
  keepBadge: { left: 45, borderColor: '#34C759', backgroundColor: 'rgba(52,199,89,0.9)', transform: [{ rotate: '-15deg' }] },
  deleteBadge: { right: 45, borderColor: '#FF3B30', backgroundColor: 'rgba(255,59,48,0.9)', transform: [{ rotate: '15deg' }] },
  badgeText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: 2 },
  actions: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, zIndex: 30 },
  button: { width: 58, height: 58, borderRadius: 29, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  delete: { backgroundColor: '#FF3B30' }, undo: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#687076' }, keep: { backgroundColor: '#34C759' },
  reset: { position: 'absolute', bottom: 76, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8, zIndex: 30 },
  resetText: { color: '#687076', fontSize: 13, fontWeight: '600' },
  modal: { flex: 1, backgroundColor: '#101010' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12, backgroundColor: '#101010', zIndex: 10 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginRight: 15 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
});