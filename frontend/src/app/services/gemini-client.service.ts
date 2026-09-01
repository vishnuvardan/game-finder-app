import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class GeminiClientService {
  private apiUrl = this.getApiUrl();

  private getApiUrl(): string {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3000/api';
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  generateScriptProxy(promptTopic: string, tone: string, language: string = 'en'): Observable<ShortsScriptResponse> {
    return this.http.post<ShortsScriptResponse>(`${this.apiUrl}/shorts/proxy-gemini`, {
      promptTopic,
      tone,
      language
    });
  }

  generateTtsProxy(text: string, subtitles: SubtitleSegment[], voiceSelection: string, rate?: string, pitch?: string): Observable<{ audio: string, subtitles: SubtitleSegment[] }> {
    return this.http.post<{ audio: string, subtitles: SubtitleSegment[] }>(`${this.apiUrl}/shorts/proxy-tts`, { text, subtitles, voiceSelection, rate, pitch });
  }

  publishInstagramReel(video: string, caption: string, password?: string): Observable<{ success: boolean, postId: string }> {
    return this.http.post<{ success: boolean, postId: string }>(`${this.apiUrl}/social/publish-instagram-reel`, {
      video,
      caption,
      password
    });
  }

  /**
   * Call the Google AI Studio REST API directly from the browser using a custom key.
   */
  async generateScriptDirect(promptTopic: string, apiKey: string, language: string = 'en', tone: string = 'controversial'): Promise<ShortsScriptResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const isTamil = language === 'ta';
    const isFriendly = tone === 'friendly' || tone === 'buddy';
    
    const audienceRule = isFriendly
      ? (isTamil ? 'Address audience warmly as "nanba" (நண்பா).' : 'Address audience warmly as "friends".')
      : 'Speak directly and naturally to the viewer without forcing repetitive address greetings.';

    const languagePrompt = isTamil 
      ? `Target language: 80% Tamil in Tamil script and 20% English words in Latin alphabet (modern conversational style). ${audienceRule}`
      : `Target language: English. ${audienceRule}`;

    const requestBody = {
      contents: [{
        parts: [{
          text: `Create a viral, high-retention script about: "${promptTopic}". Tone: ${tone}. ${languagePrompt} Return structured JSON with clickbait title, script narration, and sequential subtitles.`
        }]
      }],
      systemInstruction: {
        parts: [{
          text: isTamil
            ? "You are an expert viral TikTok/Reels short-form scriptwriter for modern Tamil gaming and tech audiences. Given a user topic, produce high-retention text for a 30-50s Short video in exactly 80% Tamil script and 20% English words (standard English for jargon, game titles, numbers, and tech words). Return STRICT JSON matching the schema."
            : "You are an expert viral TikTok/Reels short-form scriptwriter. Given a user topic, produce high-tension text for a 30-50s Short video. Return STRICT JSON matching the schema."
        }]
      },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: {
              type: 'STRING',
              description: 'ALL-CAPS PUNCHY RAGE-BAIT QUESTION OR HOOK UNDER 10 WORDS',
            },
            script: {
              type: 'STRING',
              description: 'Full 30-50s continuous speech text for voice synthesis. No brackets or stage directions.',
            },
            subtitles: {
              type: 'ARRAY',
              description: 'Chronological subtitle segments spanning the entire duration of the script.',
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
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned error status ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('Empty response from Gemini API');
    }

    const parsed: ShortsScriptResponse = JSON.parse(responseText);
    if (!parsed.title || !parsed.script || !parsed.subtitles || !Array.isArray(parsed.subtitles)) {
      throw new Error('Response is missing required script fields');
    }

    return parsed;
  }
}
