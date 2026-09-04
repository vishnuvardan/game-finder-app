import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import axios from 'axios';
import { steamService } from './steam.service';
import { igdbService } from './igdb.service';

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

export interface QuizQuestion {
  id: string;
  questionText: string;
  options: string[];
}

export interface QuizResponse {
  themeExplanation: string;
  questions: QuizQuestion[];
}

export interface RecommendationResponse {
  recommendedTitle: string;
  reasoning: string;
}

export interface FavoriteGame {
  name: string;
  genres: string[];
}

export interface QuizAnswer {
  questionId: string;
  answer: string;
}

export interface TrophyGuideResponse {
  estimatedDifficulty: string;
  isMissable: boolean;
  timeCommitment?: string;
  prerequisites?: string[];
  walkthroughSteps: string[];
  proTip?: string;
}

export interface CarouselSlide {
  title: string;
  bullets: string[];
  footnote?: string;
  mediaUrl?: string;
  imagePool?: string[];
}

export interface CarouselResponse {
  slides: CarouselSlide[];
  caption: string;
  coverImagePrompt?: string;
  coverImageUrl?: string;
  imagePool?: string[];
}

export interface SubtitleSegment {
  text: string;
  start: number;
  end: number;
}

export interface ShortsScriptResponse {
  title: string;
  script: string;
  subtitles: SubtitleSegment[];
}

export interface YoutubeScriptSection {
  id: string;
  title: string;
  content: string;
  estimatedSeconds?: number;
  visualCue?: string;
  bulletPoints?: string[];
  imageQuery?: string;
  imageUrl?: string;
  imagePool?: string[];
}

export interface VideoScene {
  id: string;
  sectionId: string;
  chapterTitle: string;
  startTime: number;
  endTime: number;
  duration: number;
  bulletPoints: string[];
  imageQuery: string;
  imageUrl: string;
  imagePool?: string[];
  visualCue?: string;
}

export interface YoutubeScriptResponse {
  youtubeTitle: string;
  youtubeDescription: string;
  thumbnailHeadline: string;
  sections: YoutubeScriptSection[];
  callToAction: string;
  imagePool?: string[];
  tags?: string[];
  thumbnailImageUrl?: string;
}

export interface GenerateYoutubeScriptParams {
  topic: string;
  gameTitle?: string;
  domain?: string;
  tone?: string;
  language?: 'en' | 'ta';
  targetMinutes?: number;
}

export interface RegenerateSectionParams {
  topic: string;
  sectionTitle: string;
  currentContent?: string;
  hint?: string;
  tone?: string;
  language?: 'en' | 'ta';
}

class GeminiService {
  /**
   * Helper to execute models.generateContent with automatic model fallback for quota/rate-limit errors.
   * Leverages 11 different models/aliases to maximize availability on free tier.
   */
  private async generateContentWithFallback(
    contents: string,
    systemInstruction: string,
    responseSchema: any
  ): Promise<string> {
    const models = [
      'gemini-2.5-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro',
      'gemini-3.5-pro',
      'gemini-2.5-pro',
      'gemini-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ];

    let lastError: any = null;

    for (const model of models) {
      try {
        console.log(`\n================== [Gemini Request] ==================`);
        console.log(`[Model]               : ${model}`);
        console.log(`[System Instruction]  : ${systemInstruction}`);
        console.log(`[User Prompt/Content] : ${contents}`);
        console.log(`======================================================\n`);

        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        if (response.text) {
          console.log(`\n================== [Gemini Response] ==================`);
          console.log(`[Model]               : ${model}`);
          console.log(`[Response JSON]       :\n${response.text}`);
          console.log(`=======================================================\n`);
          return response.text;
        }
        throw new Error(`Empty response text from model ${model}`);
      } catch (error: any) {
        lastError = error;

        // Fall back on rate limits, quota limits, high demand, model availability, or network errors
        const isFallbackEligible =
          !error.status || // Network/Connection/Timeout errors have no status code
          error.status === 429 ||
          error.status === 503 ||
          error.status === 500 ||
          error.status === 404 ||
          (error.message && (
            error.message.toLowerCase().includes('quota') ||
            error.message.toLowerCase().includes('exhausted') ||
            error.message.toLowerCase().includes('rate limit') ||
            error.message.toLowerCase().includes('unavailable') ||
            error.message.toLowerCase().includes('high demand') ||
            error.message.toLowerCase().includes('not found') ||
            error.message.toLowerCase().includes('overloaded') ||
            error.message.toLowerCase().includes('fetch failed') ||
            error.message.toLowerCase().includes('timeout') ||
            error.message.toLowerCase().includes('connect')
          ));

        if (isFallbackEligible) {
          console.warn(`[GeminiService] Transient error or limit exceeded for model "${model}". Falling back to next model...`);
          continue;
        }

        // If it's another error (such as validation/syntax/schema error), throw it immediately
        console.error(`[GeminiService] Fatal non-fallback error encountered with model "${model}":`, error);
        throw error;
      }
    }

    throw new Error(
      `All Gemini fallback models exhausted. Last error: ${lastError?.message || lastError}`
    );
  }

  /**
   * Generates a 5-question interactive quiz based on the user's favorite games
   */
  public async generateQuiz(favoriteGames: FavoriteGame[]): Promise<QuizResponse> {
    const prompt = `
      The user's favorite games are:
      ${favoriteGames.map((game, idx) => `${idx + 1}. "${game.name}" (Genres: ${game.genres.join(', ')})`).join('\n')}

      Analyze these games and generate exactly 5 unique, highly specific multiple-choice questions to drill down into the user's specific mechanics, narrative weight, atmospheric pacing, and multiplayer preferences. Avoid generic questions.
    `;

    const systemInstruction = 
      "You are an elite, veteran video game recommendation engine. Analyze the 3 provided favorite games. " +
      "Generate exactly 5 unique, highly specific multiple-choice questions to drill down into the user's specific " +
      "mechanics, narrative weight, atmospheric pacing, and multiplayer preferences. Avoid generic questions. " +
      "Output MUST strictly match the defined JSON schema.";

    const schema = {
      type: 'OBJECT',
      properties: {
        themeExplanation: {
          type: 'STRING',
          description: 'A 1-2 sentence explanation of the theme connecting these 3 favorite games.',
        },
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'A unique ID for the question, e.g. "q1", "q2"...' },
              questionText: { type: 'STRING', description: 'The text of the question.' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Exactly 4 distinct, engaging answer options representing different gaming styles/preferences.',
              },
            },
            required: ['id', 'questionText', 'options'],
          },
        },
      },
      required: ['themeExplanation', 'questions'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: QuizResponse = JSON.parse(responseText);
      
      // Post-validation
      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error('Invalid quiz response structure: missing questions array');
      }
      
      return parsed;
    } catch (error: any) {
      console.error('Error generating quiz from Gemini:', error);
      throw new Error(`Failed to generate quiz: ${error.message}`);
    }
  }

  /**
   * Generates a game recommendation based on the user's favorite games and their answers to the quiz
   */
  public async recommendGame(
    favoriteGames: FavoriteGame[],
    quizAnswers: QuizAnswer[]
  ): Promise<RecommendationResponse> {
    const prompt = `
      The user's favorite games are:
      ${favoriteGames.map((game) => `- "${game.name}"`).join('\n')}

      The user answered the following questions:
      ${quizAnswers.map((qa) => `- Question ${qa.questionId}: Selected Answer is "${qa.answer}"`).join('\n')}

      Based on these profile parameters, recommend exactly ONE highly tailored game title that fits their preferences.
      Exclude the games from their favorite list: ${favoriteGames.map((g) => `"${g.name}"`).join(', ')}.
    `;

    const systemInstruction = 
      "You are an elite, veteran video game recommendation engine. Analyze the favorite games and their quiz answers. " +
      "Return exactly ONE highly tailored game title and a 3-sentence deep analytical reason why it fits their specific profile. " +
      "Exclude the 3 games provided in their favorite list. Output MUST strictly match the defined JSON schema.";

    const schema = {
      type: 'OBJECT',
      properties: {
        recommendedTitle: {
          type: 'STRING',
          description: 'The exact title of the recommended video game.',
        },
        reasoning: {
          type: 'STRING',
          description: 'Exactly a 3-sentence deep analytical explanation of why this game fits their preferences.',
        },
      },
      required: ['recommendedTitle', 'reasoning'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: RecommendationResponse = JSON.parse(responseText);
      return parsed;
    } catch (error: any) {
      console.error('Error generating recommendation from Gemini:', error);
      throw new Error(`Failed to recommend game: ${error.message}`);
    }
  }

  /**
   * Generates between 6 and 10 game-specific evaluation criteria ('departments')
   */
  public async generateRetrospectiveDepartments(
    gameName: string,
    genres: string[]
  ): Promise<{
    departments: string[];
    starLabels: {
      1: string;
      2: string;
      3: string;
      4: string;
      5: string;
    };
  }> {
    const prompt = `The user has just finished the game: "${gameName}" within genres: ${genres.join(', ')}.`;

    const systemInstruction = 
      `You are a critical video game reviewer. The user has just finished the game: "${gameName}" within genres: ${genres.join(', ')}. ` +
      `Your task is two-fold: \n` +
      `1. Dynamically generate between 6 and 10 highly distinct, game-specific review dimensions/questions (minimum 6, maximum 10). ` +
      `You MUST follow these rules strictly: \n` +
      `   a. Use extremely simple, easy-to-understand English (suitable for an average gamer whose primary language is not English). ` +
      `Avoid complex, academic, flowery, or jargon-heavy terms (like 'Labyrinthine', 'Ecclesiastical', 'Grotesque', 'Iconography', 'Tactile Feedback', 'Narrative Resolution', 'Soundscape'). ` +
      `Use simple terms (e.g., 'scary art style' instead of 'grotesque design'). \n` +
      `   b. Make it balanced by ensuring 30% to 50% of the items focus on criticism, negative aspects, disadvantages, or common frustrations of the game ` +
      `(e.g., game optimization/bugs, boring grinding, clunky controls, repetitive missions, excessive difficulty). \n` +
      `   c. Exactly 30% to 50% of the items must be framed as short, direct, challenging questions (e.g., 'Too much grinding?', 'Need guides to finish?', 'Bugs or lag?', 'Is story boring?'). \n` +
      `   d. The remaining items must be short 2-to-3 word simple labels (e.g., 'Combat fun', 'Boss designs', 'Music and sound'). \n` +
      `   e. Crucially, all items (both labels and questions) MUST be very short (under 30 characters) so they do not break or overflow the card layout. \n\n` +
      `2. Generate exactly 5 game-themed star rating labels (from 1 to 5 stars) specifically customized for "${gameName}". ` +
      `You MUST follow these rules strictly: \n` +
      `   a. Use extremely simple, easy-to-understand English. \n` +
      `   b. Tailor the labels to the specific theme, mood, difficulty, and lore of "${gameName}". \n` +
      `   c. Ensure a clear progression of quality (1 star is worst/most disappointing, 5 stars is best/absolute masterpiece). \n` +
      `   d. Keep each label short and punchy (under 40 characters).`;

    const schema = {
      type: 'OBJECT',
      properties: {
        departments: {
          type: 'ARRAY',
          items: { 
            type: 'STRING',
            description: 'A very short game-specific evaluation label or question, under 30 characters, in simple English.'
          },
          description: 'List of 6 to 10 game-specific evaluation criteria (30% to 50% questions, 30% to 50% critique).',
        },
        starLabels: {
          type: 'OBJECT',
          properties: {
            1: { type: 'STRING', description: 'Game-themed rating label for 1 star (worst).' },
            2: { type: 'STRING', description: 'Game-themed rating label for 2 stars.' },
            3: { type: 'STRING', description: 'Game-themed rating label for 3 stars.' },
            4: { type: 'STRING', description: 'Game-themed rating label for 4 stars.' },
            5: { type: 'STRING', description: 'Game-themed rating label for 5 stars (best).' },
          },
          required: ['1', '2', '3', '4', '5'],
          description: 'Custom, game-themed star rating labels from 1 to 5, in simple English.',
        },
      },
      required: ['departments', 'starLabels'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed = JSON.parse(responseText);
      if (!parsed.departments || !Array.isArray(parsed.departments)) {
        throw new Error('Invalid response structure: missing departments array');
      }
      if (!parsed.starLabels || typeof parsed.starLabels !== 'object') {
        throw new Error('Invalid response structure: missing starLabels object');
      }
      return {
        departments: parsed.departments,
        starLabels: {
          1: parsed.starLabels['1'] || parsed.starLabels[1] || 'Terrible',
          2: parsed.starLabels['2'] || parsed.starLabels[2] || 'Bad',
          3: parsed.starLabels['3'] || parsed.starLabels[3] || 'Average',
          4: parsed.starLabels['4'] || parsed.starLabels[4] || 'Good',
          5: parsed.starLabels['5'] || parsed.starLabels[5] || 'Masterpiece',
        }
      };
    } catch (error: any) {
      console.error('Error generating retrospective departments from Gemini:', error);
      throw new Error(`Failed to generate departments: ${error.message}`);
    }
  }

  /**
   * Generates a witty, first-person social media review draft based on the user's ratings
   */
  public async generateReviewDraft(
    reviewerName: string,
    gameName: string,
    ratings: { department: string; stars: number; label: string }[]
  ): Promise<string> {
    const ratingsSummary = ratings
      .map((r) => `- ${r.department}: ${r.stars} Stars (${r.label})`)
      .join('\n');

    const prompt = `
      Reviewer Name: ${reviewerName}
      Game: ${gameName}
      Ratings Details:
      ${ratingsSummary}
    `;

    const systemInstruction = 
      `You are a casual gamer writing a short retrospective review post for social media. ` +
      `Analyze the reviewer's name, the game, and their rating details. ` +
      `Generate a short, 3-to-4 sentence review written strictly from a First-Person Perspective ('I liked', 'I felt', 'In my play-through'). \n` +
      `You MUST follow these rules strictly: \n` +
      `1. Use extremely simple, easy-to-understand English. A person who only knows basic English must easily understand the review. \n` +
      `2. Avoid complex, flowery, academic, or heavy game-lore words (e.g., do NOT use words like 'penitent perfection', 'High Wills-tier', 'cryptic Metroidvania', 'Miracle trolling me', 'cohesive integration'). \n` +
      `3. Keep the tone engaging, casual, and authentic. Synthesize the ratings: praise the high-rated areas simply (e.g. 'art style was beautiful', 'music was awesome') and critique the low-rated areas simply (e.g. 'combat was too hard', 'driving felt clunky'). \n` +
      `4. Do not include hashtags or emojis. Output MUST strictly match the defined JSON schema.`;

    const schema = {
      type: 'OBJECT',
      properties: {
        reviewDraft: {
          type: 'STRING',
          description: 'The custom first-person written summary review block.',
        },
      },
      required: ['reviewDraft'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed = JSON.parse(responseText);
      if (!parsed.reviewDraft || typeof parsed.reviewDraft !== 'string') {
        throw new Error('Invalid response structure: missing reviewDraft string');
      }
      return parsed.reviewDraft;
    } catch (error: any) {
      console.error('Error generating review draft from Gemini:', error);
      throw new Error(`Failed to generate review draft: ${error.message}`);
    }
  }

  /**
   * Generates a step-by-step walkthrough guide for a specific trophy/achievement
   */
  public async generateTrophyGuide(
    gameName: string,
    trophyName: string,
    trophyDescription: string
  ): Promise<TrophyGuideResponse> {
    const prompt = `
      Game: "${gameName}"
      Trophy Name: "${trophyName}"
      Trophy Description: "${trophyDescription}"
    `;

    const systemInstruction = 
      "You are an elite, highly efficient video game guide writer specializing in Steam achievement completionism. " +
      "Provide an optimized, spoiler-free (where possible), tactical guide to unlock the specified achievement. " +
      "Break down the mechanical steps linearly. Be concise, accurate, and direct.";

    const schema = {
      type: "OBJECT",
      properties: {
        estimatedDifficulty: { 
          type: "STRING", 
          description: "Difficulty rating (e.g., 2/10 Easy, 7/10 Hard)." 
        },
        isMissable: { 
          type: "BOOLEAN", 
          description: "True if the player can completely lock themselves out of getting this achievement in a single playthrough." 
        },
        timeCommitment: { 
          type: "STRING", 
          description: "Estimated time needed specifically for this achievement (e.g., '15 minutes', 'Requires full playthrough')." 
        },
        prerequisites: { 
          type: "ARRAY", 
          items: { "type": "STRING" },
          description: "Any specific items, levels, skills, or story progression required before attempting."
        },
        walkthroughSteps: { 
          type: "ARRAY", 
          items: { "type": "STRING" },
          description: "Chronological, actionable steps to physically unlock the achievement."
        },
        proTip: { 
          type: "STRING", 
          description: "Glitch warnings, shortcuts, or combat strategies to make the achievement trivial." 
        }
      },
      required: ["estimatedDifficulty", "isMissable", "walkthroughSteps"]
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: TrophyGuideResponse = JSON.parse(responseText);

      // Simple validation
      if (!parsed.estimatedDifficulty || typeof parsed.isMissable !== 'boolean' || !Array.isArray(parsed.walkthroughSteps)) {
        throw new Error('Response is missing required schema fields');
      }

      return parsed;
    } catch (error: any) {
      console.error('Error generating trophy guide from Gemini:', error);
      throw new Error(`Failed to generate trophy guide: ${error.message}`);
    }
  }

  /**
   * Helper to execute models.generateContent with Google Search grounding.
   */
  private async generateSearchGroundedContent(
    contents: string,
    systemInstruction?: string
  ): Promise<string> {
    const models = [
      'gemini-2.5-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro',
      'gemini-3.5-pro',
      'gemini-2.5-pro',
      'gemini-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ];

    let lastError: any = null;

    for (const model of models) {
      try {
        console.log(`\n================== [Gemini Search Grounded Request] ==================`);
        console.log(`[Model]               : ${model}`);
        console.log(`[System Instruction]  : ${systemInstruction || 'None'}`);
        console.log(`[User Prompt/Content] : ${contents}`);
        console.log(`======================================================\n`);

        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
          },
        });

        if (response.text) {
          console.log(`\n================== [Gemini Search Grounded Response] ==================`);
          console.log(`[Model]               : ${model}`);
          console.log(`[Response Text]       :\n${response.text}`);
          console.log(`=======================================================\n`);
          return response.text;
        }
        throw new Error(`Empty response text from model ${model}`);
      } catch (error: any) {
        lastError = error;

        const isFallbackEligible =
          error.status === 429 ||
          error.status === 503 ||
          error.status === 500 ||
          error.status === 404 ||
          (error.message && (
            error.message.toLowerCase().includes('quota') ||
            error.message.toLowerCase().includes('exhausted') ||
            error.message.toLowerCase().includes('rate limit') ||
            error.message.toLowerCase().includes('unavailable') ||
            error.message.toLowerCase().includes('high demand') ||
            error.message.toLowerCase().includes('not found') ||
            error.message.toLowerCase().includes('overloaded')
          ));

        if (isFallbackEligible) {
          console.warn(`[GeminiService] Transient error or limit exceeded for search grounding model "${model}". Falling back...`);
          continue;
        }

        console.error(`[GeminiService] Fatal non-fallback error encountered with search grounding model "${model}":`, error);
        throw error;
      }
    }

    throw new Error(
      `All Gemini fallback models exhausted for search grounding. Last error: ${lastError?.message || lastError}`
    );
  }

  /**
   * Fetches high-resolution images from Google Images Search via Serper API
   */
  public async fetchGoogleImages(query: string, count: number = 15): Promise<string[]> {
    if (!config.serper.apiKey) {
      console.warn('[Serper API] No SERPER_API_KEY configured in environment');
      return [];
    }

    try {
      // Clean query preserving Unicode letters and numbers across languages (English, Tamil, etc.)
      const cleanQuery = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
      // Extract concise keywords (first 7 words max) to avoid sending whole paragraph prompts to Google Images
      const words = cleanQuery.split(' ').filter(w => w.length > 1);
      const conciseQuery = words.slice(0, 7).join(' ') || cleanQuery;

      const isGaming = /game|gaming|esports|steam|rpg|fps|playstation|xbox/i.test(query);
      const searchQuery = isGaming ? `${conciseQuery} gaming 4k wallpaper` : `${conciseQuery} high resolution hd`;
      console.log(`[Serper API] Querying Google Images for: "${searchQuery}" (count: ${count})...`);

      const response = await axios.post(
        'https://google.serper.dev/images',
        {
          q: searchQuery,
          num: Math.max(count, 10),
        },
        {
          headers: {
            'X-API-KEY': config.serper.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 6000,
        }
      );

      const images: any[] = response.data?.images || [];
      const urls: string[] = [];

      for (const img of images) {
        if (img.imageUrl && typeof img.imageUrl === 'string' && img.imageUrl.startsWith('http')) {
          urls.push(img.imageUrl);
        } else if (img.thumbnailUrl && typeof img.thumbnailUrl === 'string') {
          urls.push(img.thumbnailUrl);
        }
      }

      console.log(`[Serper API] Successfully fetched ${urls.length} images from Google Images`);
      return urls;
    } catch (err: any) {
      console.error('[Serper API] Error fetching Google Images:', err.response?.data || err.message);
      return [];
    }
  }

  /**
   * Fallback to Unsplash photos if needed
   */
  private async fetchUnsplashImages(topic: string, count: number = 10): Promise<string[]> {
    if (!config.unsplash.accessKey) return [];
    try {
      const response = await axios.get('https://api.unsplash.com/search/photos', {
        params: {
          query: `gaming ${topic}`,
          client_id: config.unsplash.accessKey,
          per_page: Math.min(count, 20),
          orientation: 'landscape',
        },
        timeout: 4000,
      });

      const results = response.data?.results;
      if (Array.isArray(results) && results.length > 0) {
        return results
          .map((photo: any) => {
            if (photo.urls?.raw) {
              return `${photo.urls.raw}&w=1080&h=1080&fit=crop&q=80`;
            }
            return photo.urls?.regular || photo.urls?.full;
          })
          .filter(Boolean);
      }
    } catch (err: any) {
      console.warn(`[Unsplash API] Error fetching unsplash images:`, err.message);
    }
    return [];
  }

  /**
   * Comprehensive multi-tier image pool retrieval
   */
  public async getImagePoolForTopic(topic: string, count: number = 15): Promise<string[]> {
    // Tier 1: Google Images Search via Serper
    const googleImages = await this.fetchGoogleImages(topic, count);
    if (googleImages.length > 0) {
      return googleImages;
    }

    // Tier 2: Unsplash Photos API
    console.log(`[Image Pool] Google Search returned 0 images. Falling back to Unsplash for topic: "${topic}"`);
    const unsplashImages = await this.fetchUnsplashImages(topic, count);
    if (unsplashImages.length > 0) {
      return unsplashImages;
    }

    // Tier 3: Curated Dynamic Fallback URL
    const lowerTopic = topic.toLowerCase();
    let queryKeyword = 'gaming';
    if (lowerTopic.includes('xbox') || lowerTopic.includes('microsoft')) {
      queryKeyword = 'xbox';
    } else if (lowerTopic.includes('playstation') || lowerTopic.includes('sony') || lowerTopic.includes('ps5') || lowerTopic.includes('ps4') || lowerTopic.includes('ps6') || lowerTopic.includes('console')) {
      queryKeyword = 'playstation';
    } else if (lowerTopic.includes('nintendo') || lowerTopic.includes('switch') || lowerTopic.includes('mario') || lowerTopic.includes('zelda') || lowerTopic.includes('retro') || lowerTopic.includes('arcade')) {
      queryKeyword = 'nintendo';
    } else if (lowerTopic.includes('esports') || lowerTopic.includes('tournament') || lowerTopic.includes('championship') || lowerTopic.includes('arena') || lowerTopic.includes('event')) {
      queryKeyword = 'esports';
    } else if (lowerTopic.includes('pc') || lowerTopic.includes('hardware') || lowerTopic.includes('steam') || lowerTopic.includes('rtx') || lowerTopic.includes('nvidia') || lowerTopic.includes('amd') || lowerTopic.includes('gpu')) {
      queryKeyword = 'gaming-setup';
    } else if (lowerTopic.includes('action') || lowerTopic.includes('shooter') || lowerTopic.includes('fps') || lowerTopic.includes('war') || lowerTopic.includes('battle')) {
      queryKeyword = 'gaming-controller';
    } else if (lowerTopic.includes('neon') || lowerTopic.includes('rgb') || lowerTopic.includes('cyberpunk')) {
      queryKeyword = 'cyberpunk-neon';
    } else {
      const words = topic.split(/\s+/).filter(w => w.length > 2 && !w.toLowerCase().includes('leak') && !w.toLowerCase().includes('rumor') && !w.toLowerCase().includes('news') && !w.toLowerCase().includes('update') && !w.toLowerCase().includes('info'));
      if (words.length > 0) {
        queryKeyword = words.slice(0, 2).join('-');
      }
    }

    const sig = Math.floor(Math.random() * 10000);
    const backupUrl = `https://images.unsplash.com/featured/1080x1080/?gaming,${encodeURIComponent(queryKeyword)}&sig=${sig}`;
    return [backupUrl];
  }

  public async getStockImageFallback(topic: string): Promise<string> {
    const pool = await this.getImagePoolForTopic(topic, 1);
    return pool[0] || `https://images.unsplash.com/featured/1080x1080/?gaming`;
  }

  public async generateSlides(
    gameName: string | undefined,
    gameSummary: string | undefined,
    genres: string[] | undefined,
    topic: string
  ): Promise<CarouselResponse> {
    // Step 1: Query Google Search Grounding to fetch the actual news and details.
    const searchQuery = gameName
      ? `Find the latest, most accurate, and specific news, dates, and details for "${gameName}" regarding "${topic}".
      Specifically search for and retrieve:
      1. Verified release dates or timing.
      2. Numbers, view counts, or community hype statistics (e.g. how many are waiting).
      3. Platforms/channels of release (e.g. YouTube vs Netflix, subscription vs free).
      4. Actionable details, expectations, or specific gameplay updates.`
      : `Find the latest, most accurate, and specific news, dates, and details regarding the gaming industry topic: "${topic}".
      Specifically search for and retrieve:
      1. Verified facts, announcements, or timing.
      2. Statistical numbers, impact analysis, or community reaction details.
      3. Platforms, companies, or services involved (e.g. Xbox, PlayStation, Steam).
      4. Actionable details or specific policy/hardware/software updates.`;
    
    let groundedInfo = "";
    try {
      groundedInfo = await this.generateSearchGroundedContent(
        searchQuery,
        "You are a professional gaming journalist. Perform a search to gather concrete details, real facts, dates, statistics, and expectations about the game and topic."
      );
    } catch (e) {
      console.warn("Failed to retrieve search-grounded information, proceeding with base prompt:", e);
    }

    const prompt = `
      ${gameName ? `Game: "${gameName}"` : 'Topic: General Gaming Industry News'}
      ${genres && genres.length > 0 ? `Genres: ${genres.join(', ')}` : ''}
      ${gameSummary ? `Description Summary: "${gameSummary}"` : ''}
      Requested Topic/Angle: "${topic}"

      ${groundedInfo ? `Here is the actual news and real-time facts retrieved from the web:\n${groundedInfo}\n` : ''}

      Analyze the input topic and the retrieved real facts. Generate between 3 and 5 dynamic, highly engaging social-media style slides (e.g. for Instagram Carousel) centered on the requested topic: "${topic}".
      
      CRITICAL INSTRUCTIONS:
      - Ground your slides in actual data, dates, and news gathered from the search results.
      - If there are specific dates, numbers of users, platform details, or company statements in the facts, include them directly in the bullets.
      - Do NOT use generic placeholder text, rumors, or vague/witty banter that tells the user nothing. Make the updates look real and informative.
      - Slide 1 (first slide) MUST be a title/cover slide. Its title should be a summary title (e.g. '${gameName ? gameName : ''} ${topic} - what you should know?'). Its bullets array must contain exactly 1 highly important, eye-catching piece of info/news hook from the research (e.g. 'Free on Game Pass Day One', 'Releasing Dec 2026', '9/10 Rating on Steam'). This will be displayed on the cover as a subtitle badge/highlight.
      - Subsequent slides (Slide 2, 3, etc.) should contain the actual bulleted updates and details.
      - Generate a catchy, engaging social media post caption (under 250 characters) summarizing these slides, including a short description and 3 to 5 relevant hashtags (e.g. #GamingNews).
    `;

    const systemInstruction = 
      `You are a professional social media content manager for a major gaming network. ` +
      `Your task is to analyze the provided game/topic (using the real facts retrieved from the web), and generate: \n` +
      `1. Between 3 and 5 highly engaging, short-form slides (carousel style). Each slide must have a clear, punchy title (under 35 chars) and exactly 3 to 5 bullet points/sentences (each under 100 chars) that are witty, informative, and customized to the topic. Optionally, provide a witty footnote/CTA (under 50 chars). \n` +
      `2. A catchy social media post caption (under 250 characters) with a brief summary of the game/topic and 3 to 5 relevant hashtags. \n` +
      `Ensure the language is simple but extremely engaging for gaming fans. Output MUST strictly match the defined JSON schema. ` +
      `CRITICAL: Avoid generic filler or placeholders. Ground your slides and caption in actual data, dates, and news gathered from the search results.`;

    const schema = {
      type: "OBJECT",
      properties: {
        slides: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { 
                type: "STRING", 
                description: "A short, punchy heading for this slide, under 35 characters." 
              },
              bullets: { 
                type: "ARRAY", 
                items: { type: "STRING" },
                description: "Exactly 3 to 5 engaging, interesting, short statements or details, under 100 characters each."
              },
              footnote: { 
                type: "STRING", 
                description: "A brief, witty quote, caption, or call to action related to this slide, under 50 characters." 
              }
            },
            required: ["title", "bullets"]
          },
          description: "List of 3 to 5 slides detailing the requested topic."
        },
        caption: {
          type: "STRING",
          description: "An engaging, catchy social media post caption (under 250 characters) summarizing the carousel slides, including 3 to 5 relevant hashtags."
        }
      },
      required: ["slides", "caption"]
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: CarouselResponse = JSON.parse(responseText);

      // Simple validation
      if (!parsed.slides || !Array.isArray(parsed.slides)) {
        throw new Error('Response is missing required slides array');
      }

      // Determine the best game query term
      let gameQuery = gameName ? gameName.trim() : '';
      if (!gameQuery && topic) {
        // Extract potential game title from the first few words of topic
        const topicWords = topic.split(/[\s,;:-]+/).filter(w => w.length > 1);
        if (topicWords.length > 0) {
          gameQuery = topicWords.slice(0, 3).join(' ');
        }
      }

      console.log(`[GeminiService] Fetching dynamic image pool for gameQuery: "${gameQuery}" (Original topic: "${topic}")`);

      let gameImages: string[] = [];

      if (gameQuery) {
        // 1. Fetch from Steam (1080p wallpapers & in-game screenshots)
        try {
          const steamImages = await steamService.getGameMediaAssets(gameQuery);
          if (steamImages.length > 0) {
            gameImages.push(...steamImages);
          }
        } catch (e: any) {
          console.warn(`[GeminiService] Steam image fetch warning for "${gameQuery}":`, e.message);
        }

        // 2. Fetch from IGDB (official artworks & screenshots)
        try {
          const igdbImages = await igdbService.getGameImages(gameQuery);
          if (igdbImages.length > 0) {
            gameImages.push(...igdbImages);
          }
        } catch (e: any) {
          console.warn(`[GeminiService] IGDB image fetch warning for "${gameQuery}":`, e.message);
        }
      }

      // If we don't have enough images (or topic-only search with no game), fetch from Google Images via Serper
      if (gameImages.length < 5) {
        const queryForGoogle = gameName ? `${gameName} ${topic}` : topic;
        console.log(`[GeminiService] Fetching Google Images for query: "${queryForGoogle}"`);
        const googleImages = await this.fetchGoogleImages(queryForGoogle, 15);
        if (googleImages.length > 0) {
          gameImages.push(...googleImages);
        }
      }

      // Deduplicate images while maintaining order
      gameImages = Array.from(new Set(gameImages.filter(url => Boolean(url) && typeof url === 'string')));

      // If still empty, fall back to general stock image pool
      if (gameImages.length === 0) {
        const fallbackPool = await this.getImagePoolForTopic(topic, 15);
        gameImages = fallbackPool;
      }

      console.log(`[GeminiService] Total distinct high-res images pooled: ${gameImages.length}. Distributing across ${parsed.slides.length} slides.`);

      // Create a shuffled copy of the image pool for randomized distribution across slides
      const shuffledImages = [...gameImages].sort(() => 0.5 - Math.random());

      // Distribute a unique distinct image to each slide
      const enrichedSlides = parsed.slides.map((slide, index) => {
        const mediaUrl = shuffledImages[index % shuffledImages.length] || gameImages[index % gameImages.length];
        return {
          ...slide,
          mediaUrl
        };
      });

      const coverImageUrl = enrichedSlides[0]?.mediaUrl || gameImages[0] || (await this.getStockImageFallback(topic));

      return {
        ...parsed,
        slides: enrichedSlides,
        coverImageUrl,
        imagePool: gameImages
      };
    } catch (error: any) {
      console.error('Error generating slides from Gemini:', error);
      throw new Error(`Failed to generate slides: ${error.message}`);
    }
  }

  public async generateSteamDealsSlides(deals: any[], category?: string): Promise<CarouselResponse> {
    if (!deals || deals.length === 0) {
      throw new Error('No deals provided for slide generation');
    }

    const dealsCount = deals.length;
    const dealsListStr = deals.map((d, i) => {
      return `${i + 1}. [Game] ${d.name} (AppID: ${d.appid})
      - Original Price: ${d.originalPrice}
      - Sale Price: ${d.finalPrice}
      - Discount: -${d.discountPercent}%
      - Description: ${d.shortDescription}`;
    }).join('\n\n');

    let categoryHeadline = 'TOP STEAM DEALS TODAY';
    if (category === 'under_500') {
      categoryHeadline = 'BEST GAMES UNDER ₹500';
    } else if (category === 'under_250') {
      categoryHeadline = 'BEST GAMES UNDER ₹250';
    } else if (category === 'under_1000') {
      categoryHeadline = 'BEST GAMES UNDER ₹1,000';
    } else if (category === 'top_sellers') {
      categoryHeadline = 'TOP SELLING STEAM DEALS';
    }

    const prompt = `Generate a premium, highly engaging Instagram Carousel presenting these Steam deals currently live in India (Prices in INR):
    
    ${dealsListStr}

    Follow these structural rules for the slides (Exactly ${dealsCount + 1} slides in total):
    1. Slide 1 (First Slide) MUST be a title/cover slide. 
       - Title: A catchy, high-impact deal headline summarizing this category (MUST be exactly: '${categoryHeadline}').
       - Bullets: Exactly 1 item highlighting the value or maximum discount (e.g. 'Save up to ${Math.max(...deals.map(d => d.discountPercent))}% Off!' or 'Best budget gaming picks live today!').
    2. Slides 2 to ${dealsCount + 1} (Game Showcase slides):
       - Slide index maps 1-to-1 with each game in the deals list.
       - Title: The game name in uppercase. If discounted, append the discount percentage (e.g. 'CYBERPUNK 2077 (-50%)'). If not discounted, just show the game name (e.g. 'CYBERPUNK 2077').
       - Bullets: Exactly 3 to 5 bullet points summarizing the game and price:
         - Price highlight: If discounted, show 'Sale price: finalPrice (was originalPrice)' as the first bullet. If not discounted, show 'Price: finalPrice' as the first bullet.
         - Gameplay & Value highlights: Detail what makes the game special and why it is a great budget pick today.
       - Footnote: A short call-to-action or gamer quote (e.g., 'Grab it before the sale ends!', 'A masterpiece for under ₹500').

    Write a compelling, gamer-focused social media post caption (with hashtags) summarizing these deals in 'caption'.
    `;

    const systemInstruction = "You are a professional video game deals analyst and editor. Write engaging, hype-building social slide content summarizing the best deals.";

    const schema = {
      type: "OBJECT",
      properties: {
        slides: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              bullets: {
                type: "ARRAY",
                items: { type: "STRING" }
              },
              footnote: { type: "STRING" }
            },
            required: ["title", "bullets"]
          }
        },
        caption: {
          type: "STRING",
          description: "A gamer-focused post caption summarizing the deals, including emojis and relevant hashtags."
        },
        coverImagePrompt: {
          type: "STRING",
          description: "A detailed image generation prompt for a generic cover graphic depicting Steam sales, digital game boxes, or gaming setups."
        }
      },
      required: ["slides", "caption", "coverImagePrompt"]
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: CarouselResponse = JSON.parse(responseText);

      if (!parsed.slides || !Array.isArray(parsed.slides)) {
        throw new Error('Response is missing required slides array');
      }

      // Aggregate all high-res images across all deals
      const allDealsImages: string[] = [];
      for (const deal of deals) {
        if (Array.isArray(deal.images) && deal.images.length > 0) {
          allDealsImages.push(...deal.images);
        }
        if (deal.headerImage) {
          allDealsImages.push(deal.headerImage);
        }
      }
      const dealsImagePool = Array.from(new Set(allDealsImages.filter(Boolean)));

      // Enrich slides with the corresponding game's screenshots and background mediaUrl
      const enrichedSlides = parsed.slides.map((slide, index) => {
        let mediaUrl = undefined;
        let slidePool: string[] = [];

        if (index === 0) {
          // Slide 1 is cover slide
          const firstDeal = deals[0];
          slidePool = firstDeal?.images?.length ? firstDeal.images : [firstDeal?.headerImage].filter(Boolean);
          mediaUrl = slidePool[0] || firstDeal?.headerImage;
        } else if (index - 1 < deals.length) {
          const deal = deals[index - 1];
          slidePool = deal?.images?.length ? deal.images : [deal?.headerImage].filter(Boolean);
          mediaUrl = slidePool[0] || deal?.headerImage;
        }

        return {
          ...slide,
          mediaUrl,
          imagePool: slidePool.length > 0 ? slidePool : dealsImagePool
        };
      });

      const coverImageUrl = enrichedSlides[0]?.mediaUrl || deals[0]?.headerImage || (await this.getStockImageFallback('steam'));

      return {
        ...parsed,
        slides: enrichedSlides,
        coverImageUrl,
        imagePool: dealsImagePool.length > 0 ? dealsImagePool : Array.from(new Set(deals.map((d: any) => d.headerImage).filter(Boolean)))
      };
    } catch (error: any) {
      console.error('Error generating Steam Deals slides from Gemini:', error);
      throw new Error(`Failed to generate Steam Deals slides: ${error.message}`);
    }
  }

  public async generateShortsScript(promptTopic: string, tone?: string, language?: string): Promise<ShortsScriptResponse> {
    const activeTone = tone || 'controversial';
    const isTamil = language === 'ta';
    
    let tonePromptInstructions = '';
    let systemRoleInstruction = '';

    if (activeTone === 'detailed') {
      systemRoleInstruction = isTamil
        ? 'You are a master investigative gaming journalist and video essayist writing in conversational TAMIL (தமிழ்). Deliver structured, fascinating technical facts and deep insights with gripping storytelling.'
        : 'You are a master investigative gaming journalist and video essayist. Deliver structured, fascinating facts, technical insights, and hidden secrets with gripping storytelling and authority.';
      tonePromptInstructions = `
TONE: Educational, Technical Deep-Dive & Investigative Analysis.
- Hook: Start with a mind-blowing, little-known fact or technical breakdown question that hooks the viewer instantly.
- Body: Deliver 3-4 concrete facts, performance metrics, or lore details with zero filler.
- Outro: End with an insightful takeaway or thought-provoking question.`;
    } else if (activeTone === 'funny') {
      systemRoleInstruction = isTamil
        ? 'You are a hilarious, meme-savvy gaming creator and streamer writing in conversational TAMIL (தமிழ்). Deliver sharp wit, gamer relatable humor, and witty punchlines.'
        : 'You are a hilarious, meme-savvy gaming creator and streamer. Deliver sharp wit, gamer relatable humor, absurd comparisons, and witty punchlines.';
      tonePromptInstructions = `
TONE: Humorous, Sarcastic, Meme-Filled & Relatable.
- Hook: Start with an absurd, funny gamer dilemma or exaggerated relatable truth.
- Body: Deliver 3-4 witty jokes, sarcastic observations, or hilarious gamer memes about the topic.
- Outro: End with a funny meme punchline or a question asking viewers to share their biggest fails.`;
    } else if (activeTone === 'hype') {
      systemRoleInstruction = isTamil
        ? 'You are a high-octane esports caster and gaming hype-creator writing in conversational TAMIL (தமிழ்). Deliver explosive adrenaline, massive excitement, and hype.'
        : 'You are a high-octane esports caster and gaming hype-creator. Deliver explosive adrenaline, massive excitement, and uncontainable energy.';
      tonePromptInstructions = `
TONE: High-Octane Hype, Adrenaline & Epic Energy.
- Hook: An explosive, legendary statement celebrating game-changing news or unbeatable moments.
- Body: High-energy countdown or feature breakdown with powerful verbs and epic pacing.
- Outro: High-intensity call to action hyping up the launch or asking viewers if their hype is real.`;
    } else if (activeTone === 'friendly' || activeTone === 'buddy') {
      systemRoleInstruction = isTamil
        ? 'You are a warm, casual, passionate gaming friend writing in conversational TAMIL (தமிழ்). Speak directly to your audience as "நண்பா" (nanba).'
        : 'You are a warm, casual, passionate gaming friend. Speak warmly directly to your audience as "friends".';
      tonePromptInstructions = `
TONE: Warm, Friendly Couch-Co-op Buddy.
- Audience Address: ${isTamil ? 'Address the audience warmly as "நண்பா" (nanba) throughout the script.' : 'Address the audience warmly as "friends" throughout the script.'}
- Hook: A friendly, welcoming hook asking how the audience feels about the topic.
- Body: Genuine, enthusiastic breakdown of why this matters and personal recommendations.
- Outro: Warm outro inviting thoughts in the comments.`;
    } else {
      // Default: Controversial / Rage-Bait / High Tension Contrarian Expose
      systemRoleInstruction = isTamil
        ? 'You are an unfiltered, fearless, controversial gaming critic and investigative insider writing in modern conversational TAMIL (தமிழ்). You expose industry lies, overhyped scams, greedy corporate decisions, and controversial hot takes that trigger massive debate.'
        : 'You are an unfiltered, fearless, controversial gaming critic and investigative insider. You expose industry lies, overhyped scams, greedy corporate decisions, and contrarian hot takes that trigger massive debate and intense engagement.';
      tonePromptInstructions = `
TONE: HIGH-TENSION CONTROVERSY, UNFILTERED RAGE-BAIT & CONTRARIAN EXPOSE.
- Hook (0-3s): MUST be an aggressive, shocking, or contrarian hot take that challenges popular opinion or exposes a bitter truth (e.g., "Stop defending this game...", "The industry is lying to you about...", "Why this is the biggest scam in gaming...").
- Body: Unpack 3-4 hard-hitting, uncomfortable facts, exposed anti-consumer moves, broken promises, or devastating arguments with high emotional tension and sharp urgency. Do NOT hold back or sound polite/diplomatic.
- Outro (CTA): Drop a polarizing, high-stakes question that forces viewers to take a side in the comments and argue fiercely.`;
    }

    const audienceRule = (activeTone === 'friendly' || activeTone === 'buddy')
      ? (isTamil ? 'Audience Address: Address the audience warmly as "நண்பா" (nanba).' : 'Audience Address: Address the audience warmly as "friends".')
      : 'Audience Address: Speak directly and naturally to the viewer (e.g. "you", "did you know", "listen to this"). Do NOT force repetitive filler names like "friends" or "nanba".';

    const langRule = isTamil
      ? `Language: 80% Tamil in Tamil Unicode script (தமிழ் எழுத்துக்களில் எழுதவும், e.g. "GTA 6 gameplay-ல இந்த ஒரு விஷயத்தை கவனிச்சீங்களா...") + 20% English words in English Latin letters (e.g. GTA 6, graphics, console, ray tracing, microtransactions, flop, scam, hype). Do NOT write Tamil in romanized English letters (Tanglish phonetics).
${audienceRule}
Script Duration: 40-60 seconds (120-150 words total). Keep sentences punchy, fast, and high-retention.`
      : `Language: English.
${audienceRule}
Script Duration: 40-60 seconds (120-150 words total). Keep sentences punchy, fast, and high-retention.`;

    const prompt = `Create a viral 45-60s Reel/Short script about: "${promptTopic}".

${tonePromptInstructions}

${langRule}

CRITICAL RULES:
1. Pacing: Write rapid-fire, high-retention voiceover text designed for TikTok/YouTube Shorts.
2. Structure: 1 Shocking Hook sentence + 3-4 punchy body breakdown points + 1 Polarizing ending question/CTA.
3. Subtitles: Provide chronological subtitle segments (2-4 words each) covering every single word from 0.0 seconds to 45-60 seconds without gaps.
4. Output STRICT JSON matching the schema.`;

    const systemInstruction = `${systemRoleInstruction} Output STRICT JSON matching the schema. Always produce comprehensive 120-150 word scripts for 45-60s video duration.`;

    const schema = {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: isTamil
            ? 'Punchy hook title under 10 words in 80% Tamil + 20% English.'
            : 'ALL-CAPS PUNCHY hook title under 10 words in English.',
        },
        script: {
          type: 'STRING',
          description: isTamil
            ? 'Full 45-60s (120-150 words) spoken speech in 80% Tamil script and 20% English words. Natural conversational flow, no brackets or stage directions.'
            : 'Full 45-60s (120-150 words) spoken speech in English. Natural high-retention flow, no brackets or stage directions.',
        },
        subtitles: {
          type: 'ARRAY',
          description: 'Chronological subtitle segments covering every single word of the script in order. The first segment MUST start at 0.0 seconds.',
          items: {
            type: 'OBJECT',
            properties: {
              text: {
                type: 'STRING',
                description: 'The subtitle phrase (2-4 words).',
              },
              start: {
                type: 'NUMBER',
                description: 'Start time in seconds.',
              },
              end: {
                type: 'NUMBER',
                description: 'End time in seconds.',
              },
            },
            required: ['text', 'start', 'end'],
          },
        },
      },
      required: ['title', 'script', 'subtitles'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: ShortsScriptResponse = JSON.parse(responseText);

      if (!parsed.title || !parsed.script || !parsed.subtitles || !Array.isArray(parsed.subtitles)) {
        throw new Error('Response is missing required script fields');
      }

      return parsed;
    } catch (error: any) {
      console.error('Error generating Shorts script from Gemini:', error);
      throw new Error(`Failed to generate Shorts script: ${error.message}`);
    }
  }

  /**
   * Generates a comprehensive long-form (5-10 min) YouTube video audio script,
   * SEO title/description, clickbait thumbnail text, and modular editable sections.
   */
  public async generateYoutubeScript(params: GenerateYoutubeScriptParams): Promise<YoutubeScriptResponse> {
    const { topic, gameTitle, domain = 'Gaming', tone = 'Engaging & Storytelling', language = 'en', targetMinutes = 8 } = params;
    
    if (!topic || topic.trim() === '') {
      throw new Error('Topic is required for YouTube script generation');
    }

    const isTamil = language === 'ta';
    const targetWordCount = Math.max(700, Math.min(1500, targetMinutes * 140));

    const prompt = `
Generate a comprehensive, high-retention long-form YouTube video script for a ${targetMinutes}-minute video (~${targetWordCount} words).

Video Details:
- Core Topic/Prompt: "${topic}"
- Domain/Genre: "${domain}"
${gameTitle ? `- Specific Game/Subject: "${gameTitle}"` : ''}
- Narration Tone: "${tone}"
- Language: ${isTamil ? 'TAMIL (தமிழ்)' : 'English'}
- Target Duration: ${targetMinutes} Minutes (~${targetWordCount} words)

Requirements:
1. YouTube Title: Write a high-CTR, SEO-optimized title (Under 70 characters, clickable, curiosity-inducing).
2. YouTube Description: Write a formatted YouTube video description with a captivating opening hook, brief outline with chapter timestamps placeholders, and 5-8 relevant hashtags.
3. Thumbnail Headline: Write a punchy, clickbaity 3-5 word headline for the 16:9 thumbnail graphic.
4. Modular Script Sections: Structure the video into 5 to 8 distinct chapters/sections:
   - Section 1 MUST be the Intro / Cold Hook (sets the stakes, presents the core mystery/question, ~60-90 seconds).
   - Sections 2 to N-1 MUST be substantive in-depth points, evidence, analysis, or lore breakdowns (detailed paragraphs with conversational flow, concrete details, and storytelling flair, ~60-120 seconds each).
   - Include visual cues describing what should be shown on screen in the visualCue field.
   - For EACH section, provide 2-3 punchy, concise bullet points (under 8-10 words each) in the bulletPoints field summarizing the core takeaways to display on the 1080p video canvas.
   - For EACH section, provide a specific image search query in imageQuery (e.g. "${gameTitle || topic} cinematic artwork 4k").
5. Call to Action / Outro: An engaging closing statement that poses a question to the viewers to drive comments, and reminds them to like and subscribe.
6. Tags: 8 to 15 comma-separated YouTube keyword tags.

${isTamil ? 'CRITICAL REQUIREMENT: The entire output (youtubeTitle, youtubeDescription, thumbnailHeadline, section titles, section narration content, bulletPoints, and callToAction) MUST be written in natural, fluent TAMIL script (தமிழ் எழுத்துக்களில்).' : ''}
`;

    const systemInstruction = isTamil 
      ? `You are an elite YouTube creator and video essayist writing top-tier long-form scripts in TAMIL (தமிழ்). Your writing is captivating, well-paced, highly informative, and structured for seamless voiceover narration. Output strictly in JSON matching the schema.`
      : `You are an elite YouTube creator and documentary essayist. You write top-tier long-form scripts with high audience retention, conversational rhythm, rich storytelling, and engaging pacing. Output strictly in JSON matching the schema.`;

    const schema = {
      type: 'OBJECT',
      properties: {
        youtubeTitle: { type: 'STRING', description: 'High-CTR YouTube video title.' },
        youtubeDescription: { type: 'STRING', description: 'SEO-rich video description with summary, chapters, and hashtags.' },
        thumbnailHeadline: { type: 'STRING', description: 'Clickbaity 3-5 word headline for thumbnail image.' },
        tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'SEO keyword tags for YouTube.' },
        sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Unique section ID e.g. "intro", "point_1", "point_2"...' },
              title: { type: 'STRING', description: 'Chapter / Section header title.' },
              content: { type: 'STRING', description: 'The complete voiceover narration script for this section (in-depth paragraph(s)).' },
              estimatedSeconds: { type: 'NUMBER', description: 'Estimated spoken duration in seconds.' },
              visualCue: { type: 'STRING', description: 'Suggested video clip / b-roll to show on screen.' },
              bulletPoints: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: '2-3 concise bullet points summarizing key takeaways of this section.'
              },
              imageQuery: { type: 'STRING', description: 'Targeted Google Images search query for this chapter visual.' },
            },
            required: ['id', 'title', 'content', 'estimatedSeconds', 'bulletPoints'],
          },
        },
        callToAction: { type: 'STRING', description: 'Outro voiceover asking viewers to comment, like, and subscribe.' },
      },
      required: ['youtubeTitle', 'youtubeDescription', 'thumbnailHeadline', 'sections', 'callToAction'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: YoutubeScriptResponse = JSON.parse(responseText);

      if (!parsed.youtubeTitle || !parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
        throw new Error('Invalid YouTube script structure from AI');
      }

      // Fetch high-res imagery for thumbnails and scenes
      let imagePool: string[] = [];
      const gameQuery = (gameTitle || topic).trim();

      if (domain.toLowerCase().includes('gaming') || gameTitle) {
        try {
          const steamImages = await steamService.getGameMediaAssets(gameQuery);
          if (steamImages.length > 0) imagePool.push(...steamImages);
        } catch (e: any) {
          console.warn(`[GeminiService] Steam image fetch warning:`, e.message);
        }

        try {
          const igdbImages = await igdbService.getGameImages(gameQuery);
          if (igdbImages.length > 0) imagePool.push(...igdbImages);
        } catch (e: any) {
          console.warn(`[GeminiService] IGDB image fetch warning:`, e.message);
        }
      }

      if (imagePool.length < 5) {
        const queryForGoogle = gameTitle ? `${gameTitle} ${topic}` : topic;
        console.log(`[GeminiService] Fetching Google Images for YouTube script query: "${queryForGoogle}"`);
        const googleImages = await this.fetchGoogleImages(queryForGoogle, 15);
        if (googleImages.length > 0) {
          imagePool.push(...googleImages);
        }
      }

      imagePool = Array.from(new Set(imagePool.filter(url => Boolean(url) && typeof url === 'string')));

      if (imagePool.length === 0) {
        const fallbackPool = await this.getImagePoolForTopic(topic, 15);
        imagePool = fallbackPool;
      }

      const shuffledPool = [...imagePool].sort(() => 0.5 - Math.random());
      const thumbnailImageUrl = shuffledPool[0] || imagePool[0];

      // Assign context-aware images to each section
      const enrichedSections = parsed.sections.map((sec, idx) => {
        const poolIndex = idx % shuffledPool.length;
        const defaultBullets = isTamil
          ? ['முக்கியமான கருத்துக்கள்', 'ஆழமான பார்வை', 'சுவாரஸ்யமான தகவல்கள்']
          : ['Key insight breakdown', 'Detailed analysis', 'Core community takeaway'];

        return {
          ...sec,
          bulletPoints: (sec.bulletPoints && sec.bulletPoints.length > 0) ? sec.bulletPoints : defaultBullets,
          imageQuery: sec.imageQuery || `${gameQuery} ${sec.title}`,
          imageUrl: shuffledPool[poolIndex] || thumbnailImageUrl,
          imagePool: shuffledPool,
        };
      });

      return {
        ...parsed,
        sections: enrichedSections,
        imagePool: shuffledPool,
        thumbnailImageUrl
      };
    } catch (error: any) {
      console.error('Error generating YouTube script from Gemini:', error);
      throw new Error(`Failed to generate YouTube script: ${error.message}`);
    }
  }

  /**
   * Regenerates or writes a single section of a YouTube script based on user hint/instruction
   */
  public async regenerateScriptSection(params: RegenerateSectionParams): Promise<{ title: string; content: string; estimatedSeconds: number; visualCue?: string; bulletPoints?: string[]; imageQuery?: string }> {
    const { topic, sectionTitle, currentContent, hint, tone = 'Engaging & Storytelling', language = 'en' } = params;
    const isTamil = language === 'ta';

    const prompt = `
Regenerate or write a specific section for a YouTube video script.

Topic: "${topic}"
Section Title: "${sectionTitle}"
${currentContent ? `Current Version:\n${currentContent}\n` : ''}
${hint ? `User Instructions / Modification Hint: "${hint}"\n` : ''}
Tone: "${tone}"
Language: ${isTamil ? 'TAMIL (தமிழ்)' : 'English'}

Requirements:
1. Write a rich, detailed voiceover paragraph (~100 to 250 words) specifically for this section.
2. Provide 2-3 concise bullet points (under 10 words each) for infographic display.
3. Provide an image search query for this chapter.
${isTamil ? 'Output MUST be written in natural, fluent TAMIL (தமிழ்).' : ''}
`;

    const systemInstruction = isTamil
      ? 'You are an elite YouTube scriptwriter writing in TAMIL (தமிழ்). Rewrite this section with high energy and conversational flow. Output JSON.'
      : 'You are an elite YouTube scriptwriter. Rewrite this section with captivating voiceover rhythm, concrete details, and high engagement. Output JSON.';

    const schema = {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Updated section title.' },
        content: { type: 'STRING', description: 'The complete voiceover narration script for this section.' },
        estimatedSeconds: { type: 'NUMBER', description: 'Estimated duration in seconds.' },
        visualCue: { type: 'STRING', description: 'Visual b-roll cue.' },
        bulletPoints: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: '2-3 concise bullet points summarizing key takeaways.'
        },
        imageQuery: { type: 'STRING', description: 'Image search query.' }
      },
      required: ['title', 'content', 'estimatedSeconds', 'bulletPoints'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      return JSON.parse(responseText);
    } catch (error: any) {
      console.error('Error regenerating script section:', error);
      throw new Error(`Failed to regenerate script section: ${error.message}`);
    }
  }
}

export const geminiService = new GeminiService();

