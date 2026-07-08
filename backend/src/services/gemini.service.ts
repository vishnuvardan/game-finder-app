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
        console.log(`[GeminiService] Attempting request using model: ${model}`);
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
  ): Promise<string[]> {
    const prompt = `The user has just finished the game: "${gameName}" within genres: ${genres.join(', ')}.`;

    const systemInstruction = 
      `You are a critical video game reviewer and taxonomist. The user has just finished the game: "${gameName}" within genres: ${genres.join(', ')}. ` +
      `Dynamically generate between 6 and 10 highly distinct, game-specific review dimensions (minimum 6, maximum 10). ` +
      `Ensure they remain hyper-tailored to the specific mechanics, pacing, and identity of the selected title. ` +
      `For example, do NOT ask about 'Platforming' for a Batman game—instead generate metrics like 'Superhero Power Fantasy Integration' or 'Combat Build Variety'. ` +
      `Do NOT ask about 'Guns' for Mario—instead ask about 'Level/Platforming Momentum'. ` +
      `Keep names short, clear, and phrase them as distinct dimensions (e.g., 'Atmospheric Depth', 'Narrative Resolution Consistency', 'Replayability Value').`;

    const schema = {
      type: 'OBJECT',
      properties: {
        departments: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'List of 6 to 10 game-specific evaluation criteria.',
        },
      },
      required: ['departments'],
    };

    try {
      const responseText = await this.generateContentWithFallback(prompt, systemInstruction, schema);
      const parsed = JSON.parse(responseText);
      if (!parsed.departments || !Array.isArray(parsed.departments)) {
        throw new Error('Invalid response structure: missing departments array');
      }
      return parsed.departments;
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
      `You are a witty, highly articulate gamer writing a short retrospective review post for social media (Reddit/X). ` +
      `Analyze the reviewer's name, the game, and their star selections. ` +
      `Generate a short, 3-to-4 sentence review written strictly from a First-Person Perspective ('I felt', 'My experience'). ` +
      `Synthesize the ratings: if they gave 5 stars to a category, praise that element heavily using gamer-centric terminology. ` +
      `If they gave 1 or 2 stars, address that flaw with casual humor or critique. ` +
      `The tone must be engaging, authentic, informal, and perfectly capture the emotional stance reflected in their ratings. ` +
      `Do not include hashtags or emojis in the core block. Output MUST strictly match the defined JSON schema.`;

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

