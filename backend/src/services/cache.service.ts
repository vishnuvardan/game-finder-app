import fs from 'fs';
import path from 'path';

class CacheService {
  private cacheFilePath = path.resolve(__dirname, '../../data/guides-cache.json');
  private achievementsCacheFilePath = path.resolve(__dirname, '../../data/achievements-cache.json');
  
  private inMemoryCache: Map<string, any> = new Map();
  private inMemoryAchievementsCache: Map<string, any> = new Map();

  constructor() {
    this.loadCacheFromFile();
    this.loadAchievementsCacheFromFile();
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
        console.log('[CacheService] No guides cache file found. Initializing empty cache.');
        this.saveCacheToFile();
      }
    } catch (error) {
      console.error('[CacheService] Error reading guides cache file:', error);
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
      console.error('[CacheService] Error writing guides cache file:', error);
    }
  }

  private loadAchievementsCacheFromFile() {
    try {
      const dirPath = path.dirname(this.achievementsCacheFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      if (fs.existsSync(this.achievementsCacheFilePath)) {
        const fileContent = fs.readFileSync(this.achievementsCacheFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        for (const [key, value] of Object.entries(parsed)) {
          this.inMemoryAchievementsCache.set(key, value);
        }
        console.log(`[CacheService] Loaded ${this.inMemoryAchievementsCache.size} achievements entries from local cache file.`);
      } else {
        console.log('[CacheService] No achievements cache file found. Initializing empty cache.');
        this.saveAchievementsCacheToFile();
      }
    } catch (error) {
      console.error('[CacheService] Error reading achievements cache file:', error);
    }
  }

  private saveAchievementsCacheToFile() {
    try {
      const obj: Record<string, any> = {};
      for (const [key, value] of this.inMemoryAchievementsCache.entries()) {
        obj[key] = value;
      }
      fs.writeFileSync(this.achievementsCacheFilePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (error) {
      console.error('[CacheService] Error writing achievements cache file:', error);
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
      console.log(`[CacheService] Cache HIT for guide: "${key}"`);
      return match;
    }
    console.log(`[CacheService] Cache MISS for guide: "${key}"`);
    return null;
  }

  /**
   * Set cached guide
   */
  public set(gameName: string, trophyName: string, data: any): void {
    const key = this.getNormalizedKey(gameName, trophyName);
    this.inMemoryCache.set(key, data);
    this.saveCacheToFile();
    console.log(`[CacheService] Cached guide and written to file for key: "${key}"`);
  }

  /**
   * Get cached achievements schema
   */
  public getAchievements(appid: string): any | null {
    const match = this.inMemoryAchievementsCache.get(appid);
    if (match) {
      console.log(`[CacheService] Cache HIT for achievements AppID: "${appid}"`);
      return match;
    }
    console.log(`[CacheService] Cache MISS for achievements AppID: "${appid}"`);
    return null;
  }

  /**
   * Set cached achievements schema
   */
  public setAchievements(appid: string, data: any): void {
    this.inMemoryAchievementsCache.set(appid, data);
    this.saveAchievementsCacheToFile();
    console.log(`[CacheService] Cached achievements and written to file for AppID: "${appid}"`);
  }
}

export const cacheService = new CacheService();
