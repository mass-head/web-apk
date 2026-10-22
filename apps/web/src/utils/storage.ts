/**
 * Local storage manager for recent conversions
 */
import { RecentBuild } from '../api/types';

const RECENT_BUILDS_KEY = 'web2apk_recent_builds_v1';

export function getRecentBuilds(): RecentBuild[] {
  try {
    const raw = localStorage.getItem(RECENT_BUILDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load recent builds from localStorage', e);
    return [];
  }
}

export function saveRecentBuild(build: RecentBuild): void {
  try {
    const existing = getRecentBuilds();
    const filtered = existing.filter((b) => b.buildId !== build.buildId);
    const updated = [build, ...filtered].slice(0, 20); // Keep last 20
    localStorage.setItem(RECENT_BUILDS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save build to localStorage', e);
  }
}

export function updateRecentBuildStatus(
  buildId: string,
  updates: Partial<RecentBuild>
): void {
  try {
    const existing = getRecentBuilds();
    const updated = existing.map((b) => (b.buildId === buildId ? { ...b, ...updates } : b));
    localStorage.setItem(RECENT_BUILDS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to update recent build', e);
  }
}

export function clearRecentBuilds(): void {
  try {
    localStorage.removeItem(RECENT_BUILDS_KEY);
  } catch (e) {
    console.error('Failed to clear recent builds', e);
  }
}
