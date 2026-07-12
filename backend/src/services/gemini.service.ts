import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

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

        // Check if error is a rate limit / quota exceeded (e.g., status 429 or containing "quota"/"exhausted")
        const isQuotaError =
          error.status === 429 ||
          (error.message && error.message.toLowerCase().includes('quota')) ||
          (error.message && error.message.toLowerCase().includes('exhausted')) ||
          (error.message && error.message.toLowerCase().includes('rate limit'));

        if (isQuotaError) {
          console.warn(`[GeminiService] Quota or rate limit exceeded for model "${model}". Falling back to next model...`);
          continue;
        }

        // If it's another error (such as validation/syntax/schema error), throw it immediately
        console.error(`[GeminiService] Non-quota error encountered with model "${model}":`, error);
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
}

export const geminiService = new GeminiService();

