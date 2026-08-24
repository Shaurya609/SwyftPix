import * as MediaLibrary from 'expo-media-library';
import { File } from 'expo-file-system';
import { MockMediaItem, MediaType } from '../types/media';

// Cache for albumId to albumTitle lookup to avoid calling getAlbumsAsync repeatedly
let albumCache: Map<string, string> | null = null;

/**
 * Request and check permission status for accessing media library
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
 * Classifies the origin/source folder of an asset based on album title and metadata
 */
function determineSource(
  asset: MediaLibrary.Asset,
  albumTitle?: string
): MockMediaItem['source'] {
  const isVideo = asset.mediaType === 'video';
  
  // 1. Try to match by album title
  if (albumTitle) {
    const name = albumTitle.toLowerCase();
    if (name.includes('screenshot')) return 'Screenshots';
    if (name.includes('whatsapp')) return 'WhatsApp';
    if (name.includes('download')) return 'Downloads';
    if (name.includes('camera') || name.includes('dcim') || name.includes('camera roll') || name.includes('recents')) {
      return isVideo ? 'Videos' : 'Camera';
    }
    if (name.includes('video')) return 'Videos';
  }

  // 2. Try to match by filename or URI path if album title is missing
  const filename = (asset.filename || '').toLowerCase();
  const uri = (asset.uri || '').toLowerCase();

  if (filename.includes('screenshot') || uri.includes('screenshot')) return 'Screenshots';
  if (filename.includes('whatsapp') || uri.includes('whatsapp')) return 'WhatsApp';
  if (filename.includes('download') || uri.includes('download')) return 'Downloads';

  // 3. Fallback based on media type
  return isVideo ? 'Videos' : 'Camera';
}

/**
 * Formats video duration in seconds (number) to "MM:SS" or "H:MM:SS"
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
 *
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

  return 0; // Fallback indicator
}

/**
 * Fetches a paginated batch of device photos and videos, and transforms them into MockMediaItem structure
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
    // 1. Get album mapping cache
    const albumMap = await getAlbumMap();

    // 2. Query media library (photos and videos, newest first)
    const pagedAssets = await MediaLibrary.getAssetsAsync({
      first: limit,
      after: afterAssetId,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [MediaLibrary.SortBy.creationTime], // legacy SDK sorts newest first by default, or passing sortBy will force it
    });

    const { assets, endCursor, hasNextPage } = pagedAssets;

    // 3. For each asset, fetch size and map to MockMediaItem structure in parallel
    const mappedItems: MockMediaItem[] = await Promise.all(
      assets.map(async (asset) => {
        // Fetch accurate file size
        const finalSize = await fetchAssetSize(asset.id, asset.uri);

        // Map creationTime to ISO string
        let dateCreatedStr = new Date().toISOString();
        if (asset.creationTime) {
          dateCreatedStr = new Date(asset.creationTime).toISOString();
        }

        // Determine source classification
        const albumTitle = asset.albumId ? albumMap.get(asset.albumId) : undefined;
        const source = determineSource(asset, albumTitle);

        // Map file type
        const fileType: MediaType = asset.mediaType === 'video' 
          ? 'video' 
          : (source === 'Screenshots' ? 'screenshot' : (source === 'WhatsApp' ? 'whatsapp' : 'photo'));

        // Populate required MockMediaItem compatible fields
        const item: MockMediaItem = {
          id: asset.id,
          fileName: asset.filename || `MEDIA_${asset.id}`,
          fileType,
          fileSize: finalSize,
          dateCreated: dateCreatedStr,
          source,
          uri: asset.uri,
        };

        // Add optional fields
        if (asset.mediaType === 'video' && asset.duration !== undefined) {
          item.duration = formatDuration(asset.duration);
        }

        // Set backup solid color representation for the card stack
        item.thumbnailColor = asset.mediaType === 'video' ? '#a1c4fd' : '#ff9a9e';

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
