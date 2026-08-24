import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

interface AudioPreviewProps {
  uri: string;
}

export function AudioPreview({ uri }: AudioPreviewProps) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }

    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }

    player.play();
  };

  const seekBy = (seconds: number) => {
    if (!status.duration) return;
    const target = Math.max(0, Math.min(status.duration, status.currentTime + seconds));
    player.seekTo(target);
  };

  const seekToPosition = (locationX: number, width: number) => {
    if (!status.duration || width <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / width));
    player.seekTo(status.duration * ratio);
  };

  const progress = status.duration > 0
    ? Math.min(1, Math.max(0, status.currentTime / status.duration))
    : 0;

  return (
    <View style={styles.container}>
      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => seekBy(-10)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Back 10 seconds"
        >
          <MaterialIcons name="replay-10" size={28} color="#6C5CE7" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playButton}
          onPress={togglePlayback}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}
        >
          <MaterialIcons
            name={status.playing ? 'pause' : 'play-arrow'}
            size={42}
            color="#FFFFFF"
            style={status.playing ? undefined : { marginLeft: 3 }}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => seekBy(10)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Forward 10 seconds"
        >
          <MaterialIcons name="forward-10" size={28} color="#6C5CE7" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.timelineContainer}
        activeOpacity={1}
        onPress={(event) => seekToPosition(event.nativeEvent.locationX, event.nativeEvent.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Audio timeline"
      >
        <View style={styles.track}>
          <View style={[styles.progress, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(status.currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(status.duration)}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginBottom: 18,
  },
  skipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(108, 92, 231, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#6C5CE7',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  timelineContainer: {
    width: '100%',
    paddingVertical: 8,
  },
  track: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(108, 92, 231, 0.22)',
  },
  progress: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#6C5CE7',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  timeText: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
  },
});
