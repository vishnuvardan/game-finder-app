import axios from 'axios';
import { config } from '../config';

interface IGDBTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface IGDBGame {
  id: number;
  name: string;
  coverUrl: string;
  summary: string;
  genres: string[];
  platforms: string[];
}

class IGDBService {
  private accessToken: string | null = null;
  private expiresAt: number = 0; // Timestamp in milliseconds

  /**
   * Retrieves a valid Twitch OAuth2 token, fetching a new one if expired or not yet loaded.
   */
  private async getAccessToken(): Promise<string> {
    const bufferTime = 60000; // 1 minute safety buffer
    if (this.accessToken && Date.now() < this.expiresAt - bufferTime) {
      return this.accessToken;
    }

    try {
      console.log('Fetching new Twitch OAuth2 Access Token...');
      const response = await axios.post<IGDBTokenResponse>(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
          params: {
            client_id: config.igdb.clientId,
            client_secret: config.igdb.clientSecret,
            grant_type: 'client_credentials',
          },
        }
      );

      const { access_token, expires_in } = response.data;
      this.accessToken = access_token;
      this.expiresAt = Date.now() + expires_in * 1000;
      console.log('Twitch OAuth2 Token successfully cached.');
      return this.accessToken;
    } catch (error: any) {
      console.error('Error fetching Twitch token:', error?.response?.data || error.message);
      throw new Error('Failed to authenticate with Twitch/IGDB API');
    }
  }

  /**
   * Search for games on IGDB
   * @param query Search string
   * @param limit Maximum results (default 8)
   */
  public async searchGames(query: string, limit: number = 8): Promise<IGDBGame[]> {
    try {
      const token = await this.getAccessToken();

      // Clean the query string for security/safety in the search directive
      const cleanQuery = query.replace(/[\\"]/g, '\\$&');

      // Construct Apex query body
      // We search by name and select fields
      const queryBody = `
        search "${cleanQuery}";
        fields name, cover.url, summary, genres.name, platforms.name;
        limit ${limit};
      `;

      const response = await axios.post<any[]>(
        'https://api.igdb.com/v4/games',
        queryBody,
        {
          headers: {
            'Client-ID': config.igdb.clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
        }
      );

      return this.parseIGDBGames(response.data);
    } catch (error: any) {
      console.error('Error querying IGDB search:', error?.response?.data || error.message);
      // Return empty array instead of crashing, or propagate the error
      throw new Error(`IGDB Search failed: ${error.message}`);
    }
  }

  /**
   * Search for a game by its precise title (used on the reveal screen)
   */
  public async getGameByTitle(title: string): Promise<IGDBGame | null> {
    try {
      const token = await this.getAccessToken();
      const cleanTitle = title.replace(/[\\"]/g, '\\$&');

      // Use a strict where filter first, fallback to search if not found
      // We want to fetch the exact game or the best match
      const queryBody = `
        fields name, cover.url, summary, genres.name, platforms.name;
        where name = "${cleanTitle}";
        limit 1;
      `;

      let response = await axios.post<any[]>(
        'https://api.igdb.com/v4/games',
        queryBody,
        {
          headers: {
            'Client-ID': config.igdb.clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
        }
      );

      // If we couldn't find an exact match, try a general search and pick the first result
      if (!response.data || response.data.length === 0) {
        console.log(`Exact match not found for "${title}". Performing standard search...`);
        const searchResults = await this.searchGames(title, 1);
        return searchResults.length > 0 ? searchResults[0] : null;
      }

      const parsed = this.parseIGDBGames(response.data);
      return parsed.length > 0 ? parsed[0] : null;
    } catch (error: any) {
      console.error('Error fetching game by title from IGDB:', error?.response?.data || error.message);
      return null;
    }
  }

  /**
   * Helper to parse and map raw IGDB results to the IGDBGame interface
   */
  private parseIGDBGames(rawGames: any[]): IGDBGame[] {
    if (!Array.isArray(rawGames)) return [];

    return rawGames.map((game) => {
      // Map cover URL, convert from default thumb to cover_big (better resolution)
      let coverUrl = '';
      if (game.cover && game.cover.url) {
        coverUrl = game.cover.url;
        if (coverUrl.startsWith('//')) {
          coverUrl = 'https:' + coverUrl;
        }
        // Change thumb to cover_big
        coverUrl = coverUrl.replace('t_thumb', 't_cover_big');
      } else {
        // High quality placeholder image for box art
        coverUrl = 'https://placehold.co/600x800/1e1e24/ff007f?text=No+Cover+Art';
      }

      // Map genres
      const genres = Array.isArray(game.genres)
        ? game.genres.map((g: any) => g.name).filter(Boolean)
        : [];

      // Map platforms
      const platforms = Array.isArray(game.platforms)
        ? game.platforms.map((p: any) => p.name).filter(Boolean)
        : [];

      return {
        id: game.id,
        name: game.name || 'Unknown Game',
        coverUrl,
        summary: game.summary || 'No summary description available for this game.',
        genres,
        platforms,
      };
    });
  }
}

export const igdbService = new IGDBService();
