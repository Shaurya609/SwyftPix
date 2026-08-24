import * as MediaLibrary from 'expo-media-library';
import { File } from 'expo-file-system';
import { MockMediaItem, MediaType } from '../types/media';

// Cache for albumId to albumTitle lookup to avoid calling getAlbumsAsync repeatedly
let albumCache: Map<string, string> | null = null;

/**
 * Request and check permission status for accessing media library.
 * Audio is included so the device index can grow beyond photos/videos.
 */
export async function checkAndRequestPermissions(): Promise<boolean> {
  try {
    const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video', 'audio']);

    if (status === 'granted') {
      return true;
    }

    if (canAskAgain) {
      const { status: requestStatus } = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video', 'audio']);
      return requestStatus === 'granted';
    }

    return false;
  } catch (error) {
    console.error('[DeviceMedia] Error checking/requesting permissions:', error);
    return false;
  }
}

/**
 * Helper to build/refresh the album lookup cache
 */
async function getAlbumMap(): Promise<Map<string, string>> {
  if (albumCache) {
    return albumCache;
  }

  const map = new Map<string, string>();
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (const album of albums) {
      if (album.id && album.title) {
        map.set(album.id, album.title);
      }
    }
    albumCache = map;
  } catch (error) {
    console.error('[DeviceMedia] Error loading albums:', error);
  }
  return map;
}

/**
 * Classifies the origin/source folder of an asset based on album title and metadata.
 */
function determineSource(
  asset: MediaLibrary.Asset,
  albumTitle?: string
): MockMediaItem['source'] {
  const isVideo = asset.mediaType === 'video';
  const isAudio = asset.mediaType === 'audio';

  if (albumTitle) {
    const name = albumTitle.toLowerCase();
    if (name.includes('screenshot')) return 'Screenshots';
    if (name.includes('whatsapp')) return 'WhatsApp';
    if (name.includes('download')) return 'Downloads';
    if (name.includes('music') || name.includes('audio') || name.includes('podcast')) return 'Music';
    if (name.includes('archive')) return 'Archives';
    if (name.includes('apk')) return 'APKs';
    if (name.includes('camera') || name.includes('dcim') || name.includes('camera roll') || name.includes('recents')) {
      return isVideo ? 'Videos' : 'Camera';
    }
    if (name.includes('video')) return 'Videos';
  }

  const filename = (asset.filename || '').toLowerCase();
  const uri = (asset.uri || '').toLowerCase();

  if (filename.includes('screenshot') || uri.includes('screenshot')) return 'Screenshots';
  if (filename.includes('whatsapp') || uri.includes('whatsapp')) return 'WhatsApp';
  if (filename.includes('download') || uri.includes('download')) return 'Downloads';
  if (isAudio) return 'Music';

  return isVideo ? 'Videos' : 'Camera';
}

/**
 * Formats a media duration in seconds to "MM:SS" or "H:MM:SS".
 */
function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const formattedSecs = secs < 10 ? `0${secs}` : secs;
  if (hrs > 0) {
    const formattedMins = mins < 10 ? `0${mins}` : mins;
    return `${hrs}:${formattedMins}:${formattedSecs}`;
  }
  return `${mins}:${formattedSecs}`;
}

/**
 * Fetches the file size without requesting full MediaLibrary asset metadata.
 * Calling MediaLibrary.getAssetInfoAsync() on Android can trigger EXIF access,
 * which requires ACCESS_MEDIA_LOCATION. SwyftPix only needs the file size here,
 * so use the asset URI directly with the modern expo-file-system File API.
 */
async function fetchAssetSize(assetId: string, fallbackUri?: string): Promise<number> {
  if (!fallbackUri) {
    return 0;
  }

  try {
    const file = new File(fallbackUri);
    const fileInfo = file.info();

    if (typeof fileInfo.size === 'number' && fileInfo.size > 0) {
      return fileInfo.size;
    }
  } catch {
    // Some MediaStore URIs may not expose file metadata. Keep the asset usable.
  }

  return 0;
}

/**
 * Fetches a paginated batch of device photos, videos, and audio, then transforms
 * them into the normalized SwyftPixAsset-compatible structure.
 */
export interface FetchPageResult {
  items: MockMediaItem[];
  endCursor: string;
  hasNextPage: boolean;
}

export async function fetchDeviceMediaPage(
  limit: number,
  afterAssetId?: string
): Promise<FetchPageResult> {
  try {
    const albumMap = await getAlbumMap();

    const pagedAssets = await MediaLibrary.getAssetsAsync({
      first: limit,
      after: afterAssetId,
      mediaType: [
        MediaLibrary.MediaType.photo,
        MediaLibrary.MediaType.video,
        MediaLibrary.MediaType.audio,
      ],
      sortBy: [MediaLibrary.SortBy.creationTime],
    });

    const { assets, endCursor, hasNextPage } = pagedAssets;

    const mappedItems: MockMediaItem[] = await Promise.all(
      assets.map(async (asset) => {
        const finalSize = await fetchAssetSize(asset.id, asset.uri);
        const dateCreatedStr = asset.creationTime
          ? new Date(asset.creationTime).toISOString()
          : new Date().toISOString();

        const albumTitle = asset.albumId ? albumMap.get(asset.albumId) : undefined;
        const source = determineSource(asset, albumTitle);
        const isVideo = asset.mediaType === 'video';
        const isAudio = asset.mediaType === 'audio';

        let fileType: MediaType;
        let category: MockMediaItem['category'];

        if (isVideo) {
          fileType = 'video';
          category = 'video';
        } else if (isAudio) {
          fileType = 'audio';
          category = 'audio';
        } else {
          fileType = source === 'Screenshots'
            ? 'screenshot'
            : source === 'WhatsApp'
              ? 'whatsapp'
              : 'photo';
          category = 'photo';
        }

        const item: MockMediaItem = {
          id: asset.id,
          fileName: asset.filename || `MEDIA_${asset.id}`,
          fileType,
          category,
          fileSize: finalSize,
          dateCreated: dateCreatedStr,
          source,
          uri: asset.uri,
          mimeType: isVideo ? 'video/*' : isAudio ? 'audio/*' : 'image/*',
        };

        if ((isVideo || isAudio) && asset.duration !== undefined) {
          item.duration = formatDuration(asset.duration);
        }

        item.thumbnailColor = isVideo
          ? '#a1c4fd'
          : isAudio
            ? '#b8a1ff'
            : '#ff9a9e';

        return item;
      })
    );

    return {
      items: mappedItems,
      endCursor,
      hasNextPage,
    };
  } catch (error) {
    console.error('[DeviceMedia] Error fetching page:', error);
    return {
      items: [],
      endCursor: '',
      hasNextPage: false,
    };
  }
}
