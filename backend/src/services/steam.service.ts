import axios from 'axios';
import { config } from '../config';

export interface SteamGameSearchResult {
  appid: string;
  name: string;
  icon?: string;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  hidden: number;
}

export interface SteamSchemaResponse {
  gameName: string;
  achievements?: SteamAchievement[];
}

class SteamService {
  /**
   * Search for games on Steam using the storefront autocomplete search endpoint
   * GET https://steamcommunity.com/actions/SearchApps/[query]
   */
  public async searchGames(query: string): Promise<SteamGameSearchResult[]> {
    try {
      console.log(`[SteamService] Searching games for query: "${query}"`);
      const response = await axios.get(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`);

      if (!response.data || !Array.isArray(response.data)) {
        return [];
      }

      return response.data.map((game: any) => ({
        appid: String(game.appid),
        name: game.name || 'Unknown Game',
        icon: game.logo || game.icon || 'https://placehold.co/120x45/1e1e24/ff007f?text=No+Image',
      }));
    } catch (error: any) {
      console.error('[SteamService] Error searching games:', error.message);
      throw new Error(`Steam Search failed: ${error.message}`);
    }
  }

  /**
   * Fetch achievement schema and game details from Steam
   * GET https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/
   */
  public async getGameSchema(appid: string): Promise<SteamSchemaResponse> {
    try {
      if (!config.steam.apiKey) {
        throw new Error('STEAM_API_KEY environment variable is not configured');
      }

      console.log(`[SteamService] Fetching game schema for AppID: ${appid}`);
      const response = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/`, {
        params: {
          key: config.steam.apiKey,
          appid: appid,
          l: 'en'
        }
      });

      const game = response.data?.game;
      if (!game) {
        throw new Error(`No game data returned for AppID: ${appid}`);
      }

      const rawAchievements = game.availableGameStats?.achievements;
      const achievements: SteamAchievement[] | undefined = Array.isArray(rawAchievements)
        ? rawAchievements.map((ach: any) => ({
            name: ach.name,
            displayName: ach.displayName || ach.name,
            description: ach.description || '',
            icon: ach.icon || 'https://placehold.co/100x100/1e1e24/ff007f?text=🏆',
            hidden: ach.hidden || 0
          }))
        : undefined;

      return {
        gameName: game.gameName || 'Unknown Game',
        achievements
      };
    } catch (error: any) {
      console.error(`[SteamService] Error fetching schema for AppID ${appid}:`, error.message);
      throw new Error(`Steam Schema fetch failed: ${error.message}`);
    }
  }

  /**
   * Fetch store details for a game from Steam Storefront AppDetails API
   * GET https://store.steampowered.com/api/appdetails
   */
  public async getAppDetails(appid: string | number): Promise<any> {
    try {
      console.log(`[SteamService] Fetching AppDetails for AppID: ${appid}`);
      const response = await axios.get(`https://store.steampowered.com/api/appdetails`, {
        params: {
          appids: String(appid),
          cc: 'in',
          l: 'english'
        }
      });
      
      const appData = response.data?.[String(appid)];
      if (appData && appData.success) {
        return appData.data;
      }
      return null;
    } catch (error: any) {
      console.error(`[SteamService] Error fetching AppDetails for AppID ${appid}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch top featured specials (discounted games) on Steam in India (INR)
   */
  public async getFeaturedSpecials(limit: number = 5, category: string = 'main'): Promise<any[]> {
    try {
      console.log(`[SteamService] Fetching specials (limit: ${limit}, category: ${category})`);
      const response = await axios.get('https://store.steampowered.com/api/featuredcategories/', {
        params: {
          cc: 'in',
          l: 'english'
        }
      });

      let items: any[] = [];
      if (category === 'top_sellers') {
        items = response.data?.top_sellers?.items || [];
      } else {
        const specials = response.data?.specials?.items || [];
        const topSellers = response.data?.top_sellers?.items || [];
        const featuredWin = response.data?.featured_win?.items || [];
        
        items = [...specials];
        const seenIds = new Set(specials.map((i: any) => i.id));
        for (const item of [...topSellers, ...featuredWin]) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            items.push(item);
          }
        }
      }

      const games: any[] = [];

      for (const item of items) {
        if (games.length >= limit) break;
        if (item.type !== 0) continue; // Only process actual games (type 0)

        // Parse prices (original and final are in cents)
        const originalPrice = item.original_price ? item.original_price / 100 : 0;
        const finalPrice = item.final_price ? item.final_price / 100 : 0;
        const discountPercent = item.discount_percent || 0;

        // Apply price filters
        if (category === 'under_500' && finalPrice > 500) {
          continue;
        }
        if (category === 'under_250' && finalPrice > 250) {
          continue;
        }
        if (category === 'under_1000' && finalPrice > 1000) {
          continue;
        }

        games.push({
          appid: String(item.id),
          name: item.name,
          discounted: item.discounted,
          discountPercent: discountPercent,
          originalPrice: item.discounted ? `₹${originalPrice.toLocaleString('en-IN')}` : `₹${finalPrice.toLocaleString('en-IN')}`,
          finalPrice: `₹${finalPrice.toLocaleString('en-IN')}`,
          headerImage: item.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`,
          headline: item.headline || '',
          shortDescription: item.discounted
            ? `Currently on sale on Steam at a ${discountPercent}% discount! Only ₹${finalPrice} down from ₹${originalPrice}.`
            : `Available on Steam for only ₹${finalPrice}.`,
          images: [] as string[]
        });
      }

      // Fetch high-res screenshots and backgrounds for the featured games in parallel
      await Promise.all(
        games.map(async (game) => {
          try {
            const details = await this.getAppDetails(game.appid);
            if (details) {
              const gameScreenshots: string[] = [];
              if (details.background_raw) gameScreenshots.push(details.background_raw);
              else if (details.background) gameScreenshots.push(details.background);

              if (Array.isArray(details.screenshots)) {
                for (const shot of details.screenshots) {
                  if (shot?.path_full) gameScreenshots.push(shot.path_full);
                }
              }
              if (details.header_image) gameScreenshots.push(details.header_image);
              game.images = Array.from(new Set(gameScreenshots.filter(Boolean)));
            }
          } catch (e: any) {
            console.warn(`[SteamService] Could not fetch details for appid ${game.appid}:`, e?.message);
          }
        })
      );

      return games;
    } catch (error: any) {
      console.error('[SteamService] Error fetching featured specials:', error.message);
      return [];
    }
  }

  /**
   * Resolve a list of game names into their Steam AppIDs and live pricing details
   */
  public async resolveGamesFromNames(names: string[]): Promise<any[]> {
    const resolvedDeals: any[] = [];
    console.log(`[SteamService] Resolving custom games list: [${names.join(', ')}]`);

    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;

      try {
        // Step 1: Search app to find AppID
        const matches = await this.searchGames(trimmed);
        if (matches.length === 0) {
          console.warn(`[SteamService] Could not find any Steam app matching: "${trimmed}"`);
          continue;
        }

        const match = matches[0]; // Take top match
        const appid = match.appid;

        // Step 2: Fetch App Details (includes price overview)
        const details = await this.getAppDetails(appid);
        if (!details) {
          console.warn(`[SteamService] Could not retrieve store details for appid: ${appid} (${match.name})`);
          continue;
        }

        // Parse price info
        const priceOverview = details.price_overview;
        const discounted = priceOverview ? priceOverview.discount_percent > 0 : false;
        const discountPercent = priceOverview ? priceOverview.discount_percent : 0;
        
        const originalPriceVal = priceOverview ? priceOverview.initial / 100 : 0;
        const finalPriceVal = priceOverview ? priceOverview.final / 100 : 0;

        const gameScreenshots: string[] = [];
        if (details.background_raw) gameScreenshots.push(details.background_raw);
        else if (details.background) gameScreenshots.push(details.background);
        if (Array.isArray(details.screenshots)) {
          for (const shot of details.screenshots) {
            if (shot?.path_full) gameScreenshots.push(shot.path_full);
          }
        }
        if (details.header_image) gameScreenshots.push(details.header_image);

        resolvedDeals.push({
          appid: String(appid),
          name: details.name || match.name,
          discounted,
          discountPercent,
          originalPrice: priceOverview ? `₹${originalPriceVal.toLocaleString('en-IN')}` : 'Free/TBD',
          finalPrice: priceOverview ? `₹${finalPriceVal.toLocaleString('en-IN')}` : 'Free/TBD',
          headerImage: details.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
          shortDescription: details.short_description || `A popular game on Steam.`,
          images: Array.from(new Set(gameScreenshots.filter(Boolean)))
        });
      } catch (err: any) {
        console.warn(`[SteamService] Failed to resolve details for game name "${trimmed}":`, err.message);
      }
    }

    return resolvedDeals;
  }

  /**
   * Fetch a rich pool of high-res wallpapers, clean backgrounds, and in-game screenshots (1920x1080) for a game from Steam
   */
  public async getGameMediaAssets(query: string): Promise<string[]> {
    if (!query || query.trim() === '') return [];

    try {
      console.log(`[SteamService] Searching Steam for media assets for query: "${query}"`);
      const searchMatches = await this.searchGames(query.trim());
      if (searchMatches.length === 0) {
        console.log(`[SteamService] No Steam app matches for "${query}"`);
        return [];
      }

      const topApp = searchMatches[0];
      const appDetails = await this.getAppDetails(topApp.appid);
      if (!appDetails) {
        return [];
      }

      const mediaPool: string[] = [];

      // 1. Clean raw background wallpaper (uncompressed 1080p/4K official key art)
      if (appDetails.background_raw) {
        mediaPool.push(appDetails.background_raw);
      } else if (appDetails.background) {
        mediaPool.push(appDetails.background);
      }

      // 2. High-res in-game screenshots (1920x1080)
      if (Array.isArray(appDetails.screenshots)) {
        for (const shot of appDetails.screenshots) {
          if (shot?.path_full) {
            mediaPool.push(shot.path_full);
          }
        }
      }

      // 3. Header storefront image
      if (appDetails.header_image) {
        mediaPool.push(appDetails.header_image);
      }

      console.log(`[SteamService] Retrieved ${mediaPool.length} high-res wallpapers & screenshots from Steam for "${topApp.name}" (AppID: ${topApp.appid})`);
      return mediaPool;
    } catch (err: any) {
      console.warn(`[SteamService] Could not fetch media assets for "${query}":`, err.message);
      return [];
    }
  }
}

export const steamService = new SteamService();

