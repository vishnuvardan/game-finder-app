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
}

export const steamService = new SteamService();
