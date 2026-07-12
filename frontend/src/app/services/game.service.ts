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
      params: { q: query },
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
