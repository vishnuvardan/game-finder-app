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

  public async getStockImageFallback(topic: string): Promise<string> {
    const lowerTopic = topic.toLowerCase();
    
    console.log(`[Unsplash Fallback] Matching local curated keywords for topic: "${topic}"`);
    
    // Extract the best query keyword based on simple rules
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
      // Clean query search term from the topic itself (e.g. "ps6 leaks" -> "ps6")
      const words = topic.split(/\s+/).filter(w => w.length > 2 && !w.toLowerCase().includes('leak') && !w.toLowerCase().includes('rumor') && !w.toLowerCase().includes('news') && !w.toLowerCase().includes('update') && !w.toLowerCase().includes('info'));
      if (words.length > 0) {
        queryKeyword = words.slice(0, 2).join('-');
      }
    }

    // Generate a random seed signature to prevent browser caching of redirects
    const sig = Math.floor(Math.random() * 10000);
    const backupUrl = `https://images.unsplash.com/featured/1080x1080/?gaming,${encodeURIComponent(queryKeyword)}&sig=${sig}`;

    // Try fetching from Unsplash API using access keys
    if (config.unsplash.accessKey) {
      try {
        console.log(`[Unsplash API] Querying Unsplash Search API for "${queryKeyword}"...`);
        const response = await axios.get('https://api.unsplash.com/search/photos', {
          params: {
            query: `gaming ${queryKeyword}`, // focus on gaming related images
            client_id: config.unsplash.accessKey,
            per_page: 15,
            orientation: 'squarish'
          },
          timeout: 4000
        });

        const results = response.data?.results;
        if (results && Array.isArray(results) && results.length > 0) {
          const randomIndex = Math.floor(Math.random() * results.length);
          const photo = results[randomIndex];
          let imgUrl = photo.urls?.regular;
          if (photo.urls?.raw) {
            imgUrl = `${photo.urls.raw}&w=1080&h=1080&fit=crop&q=80`;
          }
          if (imgUrl) {
            console.log(`[Unsplash API] Successfully fetched image from API: ${imgUrl}`);
            return imgUrl;
          }
        }
      } catch (err: any) {
        console.warn(`[Unsplash API] API request failed (falling back to backup URL):`, err.message);
      }
    }

    console.log(`[Unsplash Fallback] Using backup dynamic URL: ${backupUrl}`);
    return backupUrl;
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

      // Deduplicate images while maintaining order
      gameImages = Array.from(new Set(gameImages.filter(url => Boolean(url) && typeof url === 'string')));

      // If still empty or no game match, fall back to Unsplash stock photos
      if (gameImages.length === 0) {
        const fallback = await this.getStockImageFallback(topic);
        gameImages = [fallback];
      }

      console.log(`[GeminiService] Total distinct high-res images pooled: ${gameImages.length}. Distributing across ${parsed.slides.length} slides.`);

      // Create a shuffled copy of the image pool for randomized distribution
      const shuffledImages = [...gameImages].sort(() => 0.5 - Math.random());

      // Distribute a unique distinct image to each slide
      const enrichedSlides = parsed.slides.map((slide, index) => {
        const mediaUrl = shuffledImages[index % shuffledImages.length] || gameImages[index % gameImages.length];
        return {
          ...slide,
          mediaUrl
        };
      });

      const coverImageUrl = enrichedSlides[0]?.mediaUrl || gameImages[0] || await this.getStockImageFallback(topic);

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

      // Enrich slides with the corresponding game's header image as background mediaUrl
      const enrichedSlides = parsed.slides.map((slide, index) => {
        let mediaUrl = undefined;
        if (index === 0) {
          mediaUrl = deals[0]?.headerImage;
        } else if (index - 1 < deals.length) {
          mediaUrl = deals[index - 1]?.headerImage;
        }
        return {
          ...slide,
          mediaUrl
        };
      });

      const coverImageUrl = deals[0]?.headerImage || await this.getStockImageFallback('steam');

      return {
        ...parsed,
        slides: enrichedSlides,
        coverImageUrl
      };
    } catch (error: any) {
      console.error('Error generating Steam Deals slides from Gemini:', error);
      throw new Error(`Failed to generate Steam Deals slides: ${error.message}`);
    }
  }

  public async generateShortsScript(promptTopic: string, tone?: string): Promise<ShortsScriptResponse> {
    const activeTone = tone || 'controversial';
    
    let tonePrompt = '';
    let toneSystemInstruction = '';
    
    if (activeTone === 'detailed') {
      tonePrompt = `Create a viral, high-retention educational and informative detailed explanation script about: "${promptTopic}". No controversy or rage-bait, focus on helpfulness and interesting details.`;
      toneSystemInstruction = 
        "You are an expert viral TikTok/Reels short-form educational and informative scriptwriter. " +
        "Given a user topic, produce highly engaging, informative, and detailed breakdown text for a 30-50s Short video. Focus on interesting facts, mechanics, and trivia. " +
        "Return STRICT JSON matching the schema. The subtitles array MUST contain chronological subtitle phrases, " +
        "each with a 'text' string (2-4 words) and sequential 'start' and 'end' times in seconds covering the script from 0.0 to around 30-50 seconds.";
    } else if (activeTone === 'funny') {
      tonePrompt = `Create a viral, high-retention humorous and witty script filled with jokes and gaming memes about: "${promptTopic}".`;
      toneSystemInstruction = 
        "You are an expert viral TikTok/Reels short-form gaming humorist and comedy scriptwriter. " +
        "Given a user topic, produce highly funny, sarcastic, and meme-filled text for a 30-50s Short video. Keep the tone playful, energetic, and witty. " +
        "Return STRICT JSON matching the schema. The subtitles array MUST contain chronological subtitle phrases, " +
        "each with a 'text' string (2-4 words) and sequential 'start' and 'end' times in seconds covering the script from 0.0 to around 30-50 seconds.";
    } else if (activeTone === 'hype') {
      tonePrompt = `Create a viral, high-retention high-energy hype script about: "${promptTopic}".`;
      toneSystemInstruction = 
        "You are an expert viral TikTok/Reels short-form energetic announcer scriptwriter. " +
        "Given a user topic, produce highly motivational, enthusiastic, and epic hype text for a 30-50s Short video. Use strong, exciting vocab and keep energy maxed out. " +
        "Return STRICT JSON matching the schema. The subtitles array MUST contain chronological subtitle phrases, " +
        "each with a 'text' string (2-4 words) and sequential 'start' and 'end' times in seconds covering the script from 0.0 to around 30-50 seconds.";
    } else {
      // Default: controversial
      tonePrompt = `Create a viral, high-retention controversial script about: "${promptTopic}".`;
      toneSystemInstruction = 
        "You are an expert viral TikTok/Reels short-form scriptwriter. " +
        "Given a user topic, produce high-tension, controversial clickbait/rage-bait text for a 30-50s Short video. " +
        "Return STRICT JSON matching the schema. The subtitles array MUST contain chronological subtitle phrases, " +
        "each with a 'text' string (2-4 words) and sequential 'start' and 'end' times in seconds covering the script from 0.0 to around 30-50 seconds.";
    }

    const prompt = `
      ${tonePrompt}
      Return a structured JSON with title, script narration, and sequential subtitles.
    `;

    const systemInstruction = toneSystemInstruction;

    const schema = {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'ALL-CAPS PUNCHY hook or title under 10 words.',
        },
        script: {
          type: 'STRING',
          description: 'Full 30-50s continuous speech text for voice synthesis. Do NOT include any brackets, stage directions, or actions. Every single spoken word must be represented in the subtitles.',
        },
        subtitles: {
          type: 'ARRAY',
          description: 'Chronological subtitle segments covering every single word of the script in order. The first segment MUST start at 0.0 seconds. There should be no gaps between consecutive segments.',
          items: {
            type: 'OBJECT',
            properties: {
              text: {
                type: 'STRING',
                description: 'The subtitle phrase (2-4 words). Must match spoken words exactly.',
              },
              start: {
                type: 'NUMBER',
                description: 'Start time in seconds. First segment MUST start at 0.0.',
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
}

export const geminiService = new GeminiService();

