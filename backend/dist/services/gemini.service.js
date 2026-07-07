"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiService = void 0;
const genai_1 = require("@google/genai");
const config_1 = require("../config");
// Initialize the Google Gen AI client
const ai = new genai_1.GoogleGenAI({ apiKey: config_1.config.gemini.apiKey });
class GeminiService {
    /**
     * Generates a 5-question interactive quiz based on the user's favorite games
     */
    async generateQuiz(favoriteGames) {
        const prompt = `
      The user's favorite games are:
      ${favoriteGames.map((game, idx) => `${idx + 1}. "${game.name}" (Genres: ${game.genres.join(', ')})`).join('\n')}

      Analyze these games and generate exactly 5 unique, highly specific multiple-choice questions to drill down into the user's specific mechanics, narrative weight, atmospheric pacing, and multiplayer preferences. Avoid generic questions.
    `;
        const systemInstruction = "You are an elite, veteran video game recommendation engine. Analyze the 3 provided favorite games. " +
            "Generate exactly 5 unique, highly specific multiple-choice questions to drill down into the user's specific " +
            "mechanics, narrative weight, atmospheric pacing, and multiplayer preferences. Avoid generic questions. " +
            "Output MUST strictly match the defined JSON schema.";
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
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
                    },
                },
            });
            if (!response.text) {
                throw new Error('Gemini response was empty');
            }
            const parsed = JSON.parse(response.text);
            // Post-validation
            if (!parsed.questions || !Array.isArray(parsed.questions)) {
                throw new Error('Invalid quiz response structure: missing questions array');
            }
            return parsed;
        }
        catch (error) {
            console.error('Error generating quiz from Gemini:', error);
            throw new Error(`Failed to generate quiz: ${error.message}`);
        }
    }
    /**
     * Generates a game recommendation based on the user's favorite games and their answers to the quiz
     */
    async recommendGame(favoriteGames, quizAnswers) {
        const prompt = `
      The user's favorite games are:
      ${favoriteGames.map((game) => `- "${game.name}"`).join('\n')}

      The user answered the following questions:
      ${quizAnswers.map((qa) => `- Question ${qa.questionId}: Selected Answer is "${qa.answer}"`).join('\n')}

      Based on these profile parameters, recommend exactly ONE highly tailored game title that fits their preferences.
      Exclude the games from their favorite list: ${favoriteGames.map((g) => `"${g.name}"`).join(', ')}.
    `;
        const systemInstruction = "You are an elite, veteran video game recommendation engine. Analyze the favorite games and their quiz answers. " +
            "Return exactly ONE highly tailored game title and a 3-sentence deep analytical reason why it fits their specific profile. " +
            "Exclude the 3 games provided in their favorite list. Output MUST strictly match the defined JSON schema.";
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
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
                    },
                },
            });
            if (!response.text) {
                throw new Error('Gemini response was empty');
            }
            const parsed = JSON.parse(response.text);
            return parsed;
        }
        catch (error) {
            console.error('Error generating recommendation from Gemini:', error);
            throw new Error(`Failed to recommend game: ${error.message}`);
        }
    }
}
exports.geminiService = new GeminiService();
