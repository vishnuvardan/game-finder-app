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

export interface RAWGGame {
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
   * Search for games matching query string using RAWG API
   */
  searchGamesRawg(query: string): Observable<RAWGGame[]> {
    return this.http.get<RAWGGame[]>(`${this.apiUrl}/games/search`, {
      params: { q: query },
    });
  }

  /**
   * Fetch achievements list for a game using backend RAWG proxy
   */
  getGameAchievements(id: string | number): Observable<RAWGAchievement[]> {
    return this.http.get<RAWGAchievement[]>(`${this.apiUrl}/games/${id}/achievements`);
  }

  /**
   * Fetch game details from RAWG
   */
  getGameDetailsRawg(id: string | number): Observable<{ name: string; background_image: string }> {
    return this.http.get<{ name: string; background_image: string }>(`${this.apiUrl}/games/${id}`);
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
}
