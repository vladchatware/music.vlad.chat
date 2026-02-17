export type SoundCloudUser = {
  username?: string;
  full_name?: string;
};

export type SoundCloudTrack = {
  id: number;
  title?: string;
  duration?: number;
  artwork_url?: string;
  user?: SoundCloudUser;
  genre?: string;
  bpm?: number;
  key_signature?: string;
};
