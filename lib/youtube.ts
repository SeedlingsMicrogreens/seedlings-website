const isVideoId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);

export function youtubeEmbedUrl(videoId: unknown): string {
  const id = String(videoId ?? '').trim();
  return isVideoId(id) ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
}

export function youtubeThumbnailUrl(videoId: unknown): string {
  const id = String(videoId ?? '').trim();
  return isVideoId(id) ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : '';
}
