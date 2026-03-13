import { registerPlugin } from '@capacitor/core';

export interface BufferedLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number;
  speed?: number;
  bearing?: number;
  altitude?: number;
}

export interface LocationBufferPlugin {
  startBuffering(): Promise<void>;
  stopBuffering(): Promise<void>;
  getAndClearBuffer(): Promise<{ locations: string }>;
}

export const LocationBuffer = registerPlugin<LocationBufferPlugin>('LocationBuffer');
