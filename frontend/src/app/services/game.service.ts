import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface IGDBGame {
  id: number;
  name: string;
  coverUrl: string;
  summary: string;
  genres: string[];
  platforms: string[];
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
  caption?: string;
  coverImagePrompt?: string;
  coverImageUrl?: string;
  imagePool?: string[];
}

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

export interface SteamGame {
  appid: string;
  name: string;
  icon: string;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  hidden: number;
}

export interface TrophyGuide {
  estimatedDifficulty: string;
  isMissable: boolean;
  timeCommitment?: string;
  prerequisites?: string[];
  walkthroughSteps: string[];
  proTip?: string;
}

@Injectable({
  providedIn: 'root',
})
export class GameService {
  private apiUrl = this.getApiUrl();

  private getApiUrl(): string {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3000/api';
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  /**
   * Search for games matching query string
   */
  searchGames(query: string): Observable<IGDBGame[]> {
    return this.http.get<IGDBGame[]>(`${this.apiUrl}/games/search`, {
      params: { q: query, source: 'igdb' },
    });
  }

  /**
   * Search for games matching query string using Steam API
   */
  searchGamesSteam(query: string): Observable<SteamGame[]> {
    return this.http.get<SteamGame[]>(`${this.apiUrl}/games/search`, {
      params: { q: query },
    });
  }

  /**
   * Fetch achievements list for a game using backend Steam proxy
   */
  getGameAchievements(appid: string | number): Observable<SteamAchievement[]> {
    return this.http.get<SteamAchievement[]>(`${this.apiUrl}/games/${appid}/achievements`);
  }

  /**
   * Fetch game details from Steam
   */
  getGameDetailsSteam(appid: string | number): Observable<{ name: string; background_image: string }> {
    return this.http.get<{ name: string; background_image: string }>(`${this.apiUrl}/games/${appid}`);
  }

  /**
   * Generate walkthrough guide for a specific trophy via backend Gemini proxy
   */
  generateTrophyGuide(gameName: string, trophyName: string, trophyDescription: string): Observable<TrophyGuide> {
    return this.http.post<TrophyGuide>(`${this.apiUrl}/trophies/guide`, {
      gameName,
      trophyName,
      trophyDescription,
    });
  }

  /**
   * Returns a proxied image URL from the backend to bypass CORS checks
   */
  getProxiedImageUrl(url: string | undefined): string {
    if (!url) return 'https://placehold.co/100x100/1e1e24/ff007f?text=🏆';
    if (url.startsWith('data:') || url.startsWith('http://localhost') || url.startsWith('/') || url.includes('placehold.co')) {
      return url;
    }
    return `${this.apiUrl}/proxy-image?url=${encodeURIComponent(url)}`;
  }

  /**
   * Fetch precise details for a game by its title
   */
  getGameByTitle(title: string): Observable<IGDBGame> {
    return this.http.get<IGDBGame>(`${this.apiUrl}/games/by-title`, {
      params: { title },
    });
  }

  /**
   * Generate quiz questions based on 3 favorite games
   */
  generateQuiz(favoriteGames: FavoriteGame[]): Observable<QuizResponse> {
    return this.http.post<QuizResponse>(`${this.apiUrl}/quiz/generate`, {
      favoriteGames,
    });
  }

  /**
   * Generate recommendations based on favorite games and quiz answers
   */
  recommendGame(
    favoriteGames: FavoriteGame[],
    quizAnswers: QuizAnswer[]
  ): Observable<RecommendationResponse> {
    return this.http.post<RecommendationResponse>(`${this.apiUrl}/quiz/recommend`, {
      favoriteGames,
      quizAnswers,
    });
  }

  /**
   * Generate retrospective departments based on finished game name and genres
   */
  generateRetrospectiveDepartments(gameName: string, genres: string[]): Observable<{ departments: string[]; starLabels: { [key: number]: string } }> {
    return this.http.post<{ departments: string[]; starLabels: { [key: number]: string } }>(`${this.apiUrl}/retrospective/departments`, {
      gameName,
      genres,
    });
  }

  /**
   * Finalize retrospective review and generate AI first-person review draft
   */
  finalizeRetrospective(
    reviewerName: string,
    gameName: string,
    ratings: { department: string; stars: number; label: string }[]
  ): Observable<{ reviewDraft: string }> {
    return this.http.post<{ reviewDraft: string }>(`${this.apiUrl}/retrospective/finalize`, {
      reviewerName,
      gameName,
      ratings,
    });
  }

  /**
   * Generate dynamic slides for a game based on a topic
   */
  generateSlides(
    gameName: string | null | undefined,
    gameSummary: string | null | undefined,
    genres: string[] | null | undefined,
    topic: string
  ): Observable<CarouselResponse> {
    return this.http.post<CarouselResponse>(`${this.apiUrl}/slides/generate`, {
      gameName,
      gameSummary,
      genres,
      topic,
    });
  }

  /**
   * Generate dynamic slides displaying Steam deals
   */
  generateSteamDealsSlides(gameNames?: string[], category?: string): Observable<CarouselResponse> {
    return this.http.post<CarouselResponse>(`${this.apiUrl}/slides/steam-deals`, {
      gameNames,
      category
    });
  }

  /**
   * Publish generated slides to Instagram as a carousel
   */
  publishInstagramCarousel(images: string[], caption: string, password?: string): Observable<{ success: boolean, postId: string }> {
    return this.http.post<{ success: boolean, postId: string }>(`${this.apiUrl}/social/publish-instagram`, {
      images,
      caption,
      password
    });
  }

  /**
   * Generate long-form YouTube video script, SEO metadata, thumbnail headline, and sections
   */
  generateYoutubeScript(params: GenerateYoutubeScriptParams): Observable<YoutubeScriptResponse> {
    return this.http.post<YoutubeScriptResponse>(`${this.apiUrl}/narrator/generate`, params);
  }

  /**
   * Regenerate or write a specific section of a YouTube script
   */
  regenerateScriptSection(params: RegenerateSectionParams): Observable<{ title: string; content: string; estimatedSeconds: number; visualCue?: string; bulletPoints?: string[]; imageQuery?: string; }> {
    return this.http.post<{ title: string; content: string; estimatedSeconds: number; visualCue?: string; bulletPoints?: string[]; imageQuery?: string; }>(`${this.apiUrl}/narrator/regenerate-section`, params);
  }

  /**
   * Synthesize voiceover audio for YouTube script narration
   */
  synthesizeNarratorAudio(
    text: string,
    voice?: string,
    rate?: string,
    pitch?: string,
    sections?: any[],
    callToAction?: string
  ): Observable<NarratorTTSResponse> {
    return this.http.post<NarratorTTSResponse>(`${this.apiUrl}/narrator/tts`, {
      text,
      voice,
      rate,
      pitch,
      sections,
      callToAction
    });
  }

  /**
   * Search and fetch Serper Google Images for a specific scene
   */
  fetchSceneImages(query: string, count: number = 10): Observable<{ images: string[] }> {
    return this.http.post<{ images: string[] }>(`${this.apiUrl}/narrator/fetch-scene-images`, { query, count });
  }
}

export interface SubtitleSegment {
  text: string;
  start: number;
  end: number;
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
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoFileName?: string;
  videoStartOffset?: number;
  videoDuration?: number;
  videoVolume?: number;
  videoElement?: HTMLVideoElement;
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
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  videoFileName?: string;
  videoStartOffset?: number;
  videoDuration?: number;
  videoVolume?: number;
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

export interface ChapterTimestamp {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface NarratorTTSResponse {
  audio: string;
  voice: string;
  rate: string;
  subtitles?: SubtitleSegment[];
  chapters?: ChapterTimestamp[];
}


