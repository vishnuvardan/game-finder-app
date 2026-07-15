import fs from 'fs';
import path from 'path';

class CacheService {
  private cacheFilePath = path.resolve(__dirname, '../../data/guides-cache.json');
  private inMemoryCache: Map<string, any> = new Map();

  constructor() {
    this.loadCacheFromFile();
  }

  private loadCacheFromFile() {
    try {
      const dirPath = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      if (fs.existsSync(this.cacheFilePath)) {
        const fileContent = fs.readFileSync(this.cacheFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        for (const [key, value] of Object.entries(parsed)) {
          this.inMemoryCache.set(key, value);
        }
        console.log(`[CacheService] Loaded ${this.inMemoryCache.size} guides from local cache file.`);
      } else {
        console.log('[CacheService] No cache file found. Initializing empty cache.');
        this.saveCacheToFile();
      }
    } catch (error) {
      console.error('[CacheService] Error reading cache file:', error);
    }
  }

  private saveCacheToFile() {
    try {
      const obj: Record<string, any> = {};
      for (const [key, value] of this.inMemoryCache.entries()) {
        obj[key] = value;
      }
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (error) {
      console.error('[CacheService] Error writing cache file:', error);
    }
  }

  private getNormalizedKey(gameName: string, trophyName: string): string {
    return `${gameName.trim().toLowerCase()}_${trophyName.trim().toLowerCase()}`;
  }

  /**
   * Get cached guide
   */
  public get(gameName: string, trophyName: string): any | null {
    const key = this.getNormalizedKey(gameName, trophyName);
    const match = this.inMemoryCache.get(key);
    if (match) {
      console.log(`[CacheService] Cache HIT for key: "${key}"`);
      return match;
    }
    console.log(`[CacheService] Cache MISS for key: "${key}"`);
    return null;
  }

  /**
   * Set cached guide
   */
  public set(gameName: string, trophyName: string, data: any): void {
    const key = this.getNormalizedKey(gameName, trophyName);
    this.inMemoryCache.set(key, data);
    this.saveCacheToFile();
    console.log(`[CacheService] Cached and written to file for key: "${key}"`);
  }
}

export const cacheService = new CacheService();
