/**
 * OCEANTRACE — AppState + tiny pub/sub emitter (PLAN §7).
 * Single source of truth; UI modules subscribe via on().
 */
import { OceanEngine } from './engine/engine';

export type CameraMode = '2d' | '2.5d' | '3d';
export type Speed = 1 | 2 | 4;

export const LAYER_DEFS = [
  { key: 'baseMap', label: 'Satellite Base Map', color: '#2a5f8f' },
  { key: 'sarOverlay', label: 'SAR Image Overlay', color: '#7f92b3' },
  { key: 'oilSpill', label: 'Detected Oil Spill', color: '#ff3366' },
  { key: 'spillBoundary', label: 'Spill Boundary', color: '#ff7a9e' },
  { key: 'estSource', label: 'Estimated Source', color: '#00e676' },
  { key: 'uncRegion', label: 'Uncertainty Region', color: '#00bfff' },
  { key: 'backTraj', label: 'Backward Trajectory', color: '#ffffff' },
  { key: 'fwdTraj', label: 'Forward Trajectory', color: '#ffaa3d' },
  { key: 'vessels', label: 'Vessels (All)', color: '#5ac8fa' },
  { key: 'vesselTracks', label: 'Vessel Tracks', color: '#8fa8ff' },
  { key: 'currents', label: 'Ocean Currents', color: '#19e3ff' },
  { key: 'wind', label: 'Wind Layer', color: '#e8f4ff' },
  { key: 'particles', label: 'Particles (Simulation)', color: '#ff7a29' },
  { key: 'weather', label: 'Weather (Synthetic)', color: '#b39ddb' }
] as const;

export type LayerKey = (typeof LAYER_DEFS)[number]['key'];

export interface AppState {
  simTime: number;            // particle-toy seconds (FUN)
  tHours: number;             // hours from SAR observation (truth leeway)
  playing: boolean;
  speed: Speed;
  cameraMode: CameraMode;
  layers: Record<LayerKey, boolean>;
  showConcentration: boolean;
  booting: boolean;
  investigating: boolean;
  /** nav pill → active preset name (for center overlay preset label) */
  navPreset: string;
  engine: OceanEngine;
}

const defaultLayers = (): Record<LayerKey, boolean> => ({
  baseMap: true,
  sarOverlay: true,
  oilSpill: true,
  spillBoundary: true,
  estSource: true,
  uncRegion: false,
  backTraj: true,
  fwdTraj: true,
  vessels: true,
  vesselTracks: true,
  currents: true,
  wind: true,
  particles: false,
  weather: false
});

export const state: AppState = {
  simTime: 129600,
  tHours: 0,
  playing: false,
  speed: 1,
  cameraMode: '2d',
  layers: defaultLayers(),
  showConcentration: false,
  booting: true,
  investigating: false,
  navPreset: 'Scene',
  engine: null as unknown as OceanEngine
};

type Handler = () => void;
const listeners = new Map<string, Set<Handler>>();

export function on(event: string, fn: Handler): void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
}

export function off(event: string, fn: Handler): void {
  listeners.get(event)?.delete(fn);
}

export function emit(event: string): void {
  const set = listeners.get(event);
  if (set) for (const fn of set) fn();
}

/** Events: 'time' (simTime changed) · 'layers' · 'camera' · 'playback' · 'investigation' · 'boot' */
