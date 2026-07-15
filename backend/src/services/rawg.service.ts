import axios from 'axios';
import { config } from '../config';

export interface RAWGGameSearchResult {
  id: number;
  name: string;
  background_image: string;
}

export interface RAWGAchievement {
  id: number;
  name: string;
  description: string;
  image: string;
}

class RawgService {
  /**
   * Search for games on RAWG
   * GET /api/games?key=[key]&search=[query]&page_size=6
   */
  public async searchGames(query: string): Promise<RAWGGameSearchResult[]> {
    try {
      if (!config.rawg.apiKey) {
        throw new Error('RAWG_API_KEY environment variable is not configured');
      }

      console.log(`[RawgService] Searching games for query: "${query}"`);
      const response = await axios.get(`https://api.rawg.io/api/games`, {
        params: {
          key: config.rawg.apiKey,
          search: query,
          page_size: 6,
        },
      });

      if (!response.data || !Array.isArray(response.data.results)) {
        return [];
      }

      return response.data.results.map((game: any) => ({
        id: game.id,
        name: game.name || 'Unknown Game',
        background_image: game.background_image || 'https://placehold.co/600x400/1e1e24/ff007f?text=No+Image',
      }));
    } catch (error: any) {
      console.error('[RawgService] Error searching games:', error?.response?.data || error.message);
      throw new Error(`RAWG Search failed: ${error.message}`);
    }
  }

  /**
   * Fetch achievements list for a game
   * GET /api/games/[gameId]/achievements?key=[key]&page_size=150
   */
  public async getAchievements(gameId: string | number): Promise<RAWGAchievement[]> {
    try {
      if (!config.rawg.apiKey) {
        throw new Error('RAWG_API_KEY environment variable is not configured');
      }

      console.log(`[RawgService] Fetching achievements for game ID: ${gameId}`);
      const response = await axios.get(`https://api.rawg.io/api/games/${gameId}/achievements`, {
        params: {
          key: config.rawg.apiKey,
          page_size: 150,
        },
      });

      if (!response.data || !Array.isArray(response.data.results)) {
        return [];
      }

      return response.data.results.map((ach: any) => ({
        id: ach.id,
        name: ach.name || 'Unnamed Achievement',
        description: ach.description || 'No description provided.',
        image: ach.image || 'https://placehold.co/100x100/1e1e24/ff007f?text=🏆',
      }));
    } catch (error: any) {
      console.error(`[RawgService] Error fetching achievements for game ${gameId}:`, error?.response?.data || error.message);
      throw new Error(`RAWG Achievements fetch failed: ${error.message}`);
    }
  }

  /**
   * Fetch game details (name, image)
   */
  public async getGameDetails(gameId: string | number): Promise<{ name: string; background_image: string }> {
    try {
      if (!config.rawg.apiKey) {
        throw new Error('RAWG_API_KEY environment variable is not configured');
      }

      console.log(`[RawgService] Fetching game details for ID: ${gameId}`);
      const response = await axios.get(`https://api.rawg.io/api/games/${gameId}`, {
        params: {
          key: config.rawg.apiKey,
        },
      });

      return {
        name: response.data.name || 'Unknown Game',
        background_image: response.data.background_image || 'https://placehold.co/600x400/1e1e24/ff007f?text=No+Image',
      };
    } catch (error: any) {
      console.error(`[RawgService] Error fetching game details for ${gameId}:`, error?.response?.data || error.message);
      throw new Error(`RAWG Details fetch failed: ${error.message}`);
    }
  }
}

export const rawgService = new RawgService();
