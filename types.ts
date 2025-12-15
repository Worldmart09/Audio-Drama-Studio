export interface Character {
  id: string;
  name: string;
  voice: VoiceName;
  pitch: number; // 0.8 to 1.2
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface ScriptLine {
  id: string;
  speaker: string;
  text: string;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffer: AudioBuffer | null;
  bgmVolume: number;
  speechVolume: number;
}

export const AVAILABLE_VOICES: VoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

export const VOICE_META: Record<VoiceName, { gender: 'Male' | 'Female'; traits: string }> = {
  'Puck': { gender: 'Male', traits: 'Mischievous, Tenor' },
  'Charon': { gender: 'Male', traits: 'Deep, Authoritative' },
  'Kore': { gender: 'Female', traits: 'Gentle, Soothing' },
  'Fenrir': { gender: 'Male', traits: 'Gruff, Intense' },
  'Zephyr': { gender: 'Female', traits: 'Professional, Confident' }
};

export const SUPPORTED_LANGUAGES = [
  { code: 'English', name: 'English' },
  { code: 'Spanish', name: 'Spanish' },
  { code: 'French', name: 'French' },
  { code: 'German', name: 'German' },
  { code: 'Italian', name: 'Italian' },
  { code: 'Japanese', name: 'Japanese' },
  { code: 'Korean', name: 'Korean' },
  { code: 'Chinese', name: 'Chinese' },
  { code: 'Hindi', name: 'Hindi' },
  { code: 'Russian', name: 'Russian' },
  { code: 'Portuguese', name: 'Portuguese' },
  { code: 'Arabic', name: 'Arabic' },
] as const;

export interface BgmTrack {
  id: string;
  name: string;
  url: string;
}

export interface AudioSegment {
    audio: string;
    speaker: string;
}