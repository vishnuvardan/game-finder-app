import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import axios from 'axios';

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
}

export interface CarouselResponse {
  slides: CarouselSlide[];
  caption: string;
  coverImagePrompt?: string;
  coverImageUrl?: string;
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

        // Fall back on rate limits, quota limits, high demand, or model availability errors
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

  public async generateCoverImage(prompt: string): Promise<string | null> {
    try {
      console.log(`\n================== [Imagen Image Generation Request] ==================`);
      console.log(`[Prompt] : ${prompt}`);
      console.log(`=======================================================================\n`);
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1'
        }
      });
      if (response.generatedImages && response.generatedImages[0]?.image?.imageBytes) {
        console.log('[Imagen Service] Image generated successfully.');
        return `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
      }
      return null;
    } catch (error: any) {
      console.warn('[Imagen Service] Failed to generate cover image:', error);
      return null;
    }
  }

  public getStockImageFallback(topic: string): string {
    const lowerTopic = topic.toLowerCase();
    
    console.log(`[Unsplash Fallback] Matching local curated keywords for topic: "${topic}"`);
    
    // Choose the best matching fallback photo (all high-res square crops that support CORS)
    if (lowerTopic.includes('xbox') || lowerTopic.includes('microsoft')) {
      return 'https://images.unsplash.com/photo-1605901309584-818e25960a8f?w=1080&h=1080&fit=crop&q=80'; // Xbox console/controller
    } else if (lowerTopic.includes('playstation') || lowerTopic.includes('sony') || lowerTopic.includes('ps5') || lowerTopic.includes('ps4') || lowerTopic.includes('console')) {
      return 'https://images.unsplash.com/photo-1627856013091-fed6e4e30025?w=1080&h=1080&fit=crop&q=80'; // PS5 controller
    } else if (lowerTopic.includes('nintendo') || lowerTopic.includes('switch') || lowerTopic.includes('mario') || lowerTopic.includes('zelda') || lowerTopic.includes('retro') || lowerTopic.includes('arcade')) {
      return 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1080&fit=crop&q=80'; // Retro consoles & Switch
    } else if (lowerTopic.includes('esports') || lowerTopic.includes('tournament') || lowerTopic.includes('championship') || lowerTopic.includes('arena') || lowerTopic.includes('event')) {
      return 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1080&h=1080&fit=crop&q=80'; // Esports Arena
    } else if (lowerTopic.includes('pc') || lowerTopic.includes('hardware') || lowerTopic.includes('steam') || lowerTopic.includes('rtx') || lowerTopic.includes('nvidia') || lowerTopic.includes('amd') || lowerTopic.includes('gpu')) {
      return 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1080&h=1080&fit=crop&q=80'; // PC gaming setup
    } else {
      // Default premium gaming controller / setup
      const generalGems = [
        'https://images.unsplash.com/photo-1605901309584-818e25960a8f?w=1080&h=1080&fit=crop&q=80',
        'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1080&h=1080&fit=crop&q=80',
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1080&h=1080&fit=crop&q=80'
      ];
      return generalGems[Math.floor(Math.random() * generalGems.length)];
    }
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

      Analyze the input topic and the retrieved real facts. Generate between 6 and 10 dynamic, highly engaging social-media style slides (e.g. for Instagram Carousel) centered on the requested topic: "${topic}".
      
      CRITICAL INSTRUCTIONS:
      - Ground your slides in actual data, dates, and news gathered from the search results.
      - If there are specific dates, numbers of users, platform details, or company statements in the facts, include them directly in the bullets.
      - Do NOT use generic placeholder text, rumors, or vague/witty banter that tells the user nothing. Make the updates look real and informative.
      - Slide 1 (first slide) MUST be a title/cover slide. Its title should be a summary title (e.g. '${gameName ? gameName : ''} ${topic} - what you should know?'). Its bullets array must contain exactly 1 highly important, eye-catching piece of info/news hook from the research (e.g. 'Free on Game Pass Day One', 'Releasing Dec 2026', '9/10 Rating on Steam'). This will be displayed on the cover as a subtitle badge/highlight.
      - Subsequent slides (Slide 2, 3, etc.) should contain the actual bulleted updates and details.
      - Generate a catchy, engaging social media post caption (under 250 characters) summarizing these slides, including a short description and 3 to 5 relevant hashtags (e.g. #GamingNews).
      - Also generate a highly detailed prompt for Imagen 3 to generate a cover image for Slide 1 that visually matches the news topic. For example, if it's about Xbox physical-to-digital copy conversions, write a prompt like "A sleek modern 3D render of an Xbox console, clean digital green flow lines, glowing disc slot, technological aesthetic, high resolution". Save it in the "coverImagePrompt" property.
    `;

    const systemInstruction = 
      `You are a professional social media content manager for a major gaming network. ` +
      `Your task is to analyze the provided game/topic (using the real facts retrieved from the web), and generate: \n` +
      `1. Between 6 and 10 highly engaging, short-form slides (carousel style). Each slide must have a clear, punchy title (under 35 chars) and exactly 2 to 3 bullet points/sentences (each under 100 chars) that are witty, informative, and customized to the topic. Optionally, provide a witty footnote/CTA (under 50 chars). \n` +
      `2. A catchy social media post caption (under 250 characters) with a brief summary of the game/topic and 3 to 5 relevant hashtags. \n` +
      `3. A detailed, descriptive image generation prompt (under 100 words) for the cover slide, summarizing the visual essence of the news topic. \n` +
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
                description: "Exactly 2 to 3 engaging, interesting, short statements or details, under 100 characters each."
              },
              footnote: { 
                type: "STRING", 
                description: "A brief, witty quote, caption, or call to action related to this slide, under 50 characters." 
              }
            },
            required: ["title", "bullets"]
          },
          description: "List of 6 to 10 slides detailing the requested topic."
        },
        caption: {
          type: "STRING",
          description: "An engaging, catchy social media post caption (under 250 characters) summarizing the carousel slides, including 3 to 5 relevant hashtags."
        },
        coverImagePrompt: {
          type: "STRING",
          description: "A detailed image generation prompt for the Slide 1 cover image, describing a relevant conceptual scene, gaming item, or corporate logo/aesthetic in a modern, premium style."
        }
      },
      required: ["slides", "caption", "coverImagePrompt"]
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed: CarouselResponse = JSON.parse(responseText);

      // Simple validation
      if (!parsed.slides || !Array.isArray(parsed.slides)) {
        throw new Error('Response is missing required slides array');
      }

      let coverImageUrl: string | undefined = undefined;
      if (parsed.coverImagePrompt) {
        const base64Url = await this.generateCoverImage(parsed.coverImagePrompt);
        if (base64Url) {
          coverImageUrl = base64Url;
        } else {
          const stockUrl = this.getStockImageFallback(topic);
          if (stockUrl) {
            coverImageUrl = stockUrl;
          }
        }
      }

      return {
        ...parsed,
        coverImageUrl
      };
    } catch (error: any) {
      console.error('Error generating slides from Gemini:', error);
      throw new Error(`Failed to generate slides: ${error.message}`);
    }
  }
}

export const geminiService = new GeminiService();

