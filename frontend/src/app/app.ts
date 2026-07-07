import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameService, IGDBGame, QuizQuestion, QuizAnswer } from './services/game.service';
import { AutocompleteInput } from './components/autocomplete-input';

type AppState = 'landing' | 'loading-quiz' | 'quiz' | 'loading-recommendation' | 'reveal';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AutocompleteInput],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // App-level states managed by Signals
  protected readonly appState = signal<AppState>('landing');
  protected readonly selectedGames = signal<(IGDBGame | null)[]>([null, null, null]);
  
  // Quiz variables
  protected readonly themeExplanation = signal<string>('');
  protected readonly quizQuestions = signal<QuizQuestion[]>([]);
  protected readonly currentQuizStep = signal<number>(0);
  protected readonly quizAnswers = signal<(string | null)[]>([null, null, null, null, null]);
  
  // Final recommendation variables
  protected readonly recommendedTitle = signal<string>('');
  protected readonly reasoning = signal<string>('');
  protected readonly recommendedGameMetadata = signal<IGDBGame | null>(null);

  // Status variables
  protected readonly errorMessage = signal<string | null>(null);

  // Computeds
  protected readonly isSurpriseMeEnabled = computed(() => 
    this.selectedGames().every((game) => game !== null)
  );

  protected readonly progressPercent = computed(() => 
    ((this.currentQuizStep() + 1) / 5) * 100
  );

  protected readonly currentQuestion = computed(() => 
    this.quizQuestions()[this.currentQuizStep()]
  );

  protected readonly currentSelectedAnswer = computed(() => 
    this.quizAnswers()[this.currentQuizStep()]
  );

  constructor(private gameService: GameService) {}

  protected onGameSelected(index: number, game: IGDBGame | null) {
    const current = [...this.selectedGames()];
    current[index] = game;
    this.selectedGames.set(current);
  }

  protected generateQuiz() {
    if (!this.isSurpriseMeEnabled()) return;

    this.appState.set('loading-quiz');
    this.errorMessage.set(null);

    const favoriteGames = this.selectedGames()
      .filter((g): g is IGDBGame => g !== null)
      .map((g) => ({ name: g.name, genres: g.genres }));

    this.gameService.generateQuiz(favoriteGames).subscribe({
      next: (response) => {
        this.themeExplanation.set(response.themeExplanation);
        this.quizQuestions.set(response.questions);
        this.currentQuizStep.set(0);
        this.quizAnswers.set([null, null, null, null, null]);
        this.appState.set('quiz');
      },
      error: (err) => {
        console.error('Error generating quiz:', err);
        this.errorMessage.set('Failed to generate quiz. Please verify the backend is running and Twitch credentials are valid.');
        this.appState.set('landing');
      },
    });
  }

  protected selectAnswer(option: string) {
    const answers = [...this.quizAnswers()];
    answers[this.currentQuizStep()] = option;
    this.quizAnswers.set(answers);
  }

  protected nextStep() {
    if (this.currentQuizStep() < 4) {
      this.currentQuizStep.set(this.currentQuizStep() + 1);
    } else {
      this.submitQuizAnswers();
    }
  }

  protected prevStep() {
    if (this.currentQuizStep() > 0) {
      this.currentQuizStep.set(this.currentQuizStep() - 1);
    }
  }

  private submitQuizAnswers() {
    this.appState.set('loading-recommendation');
    this.errorMessage.set(null);

    const favoriteGames = this.selectedGames()
      .filter((g): g is IGDBGame => g !== null)
      .map((g) => ({ name: g.name, genres: g.genres }));

    const formattedAnswers: QuizAnswer[] = this.quizQuestions().map((q, idx) => ({
      questionId: q.id,
      answer: this.quizAnswers()[idx] || '',
    }));

    this.gameService.recommendGame(favoriteGames, formattedAnswers).subscribe({
      next: (rec) => {
        this.recommendedTitle.set(rec.recommendedTitle);
        this.reasoning.set(rec.reasoning);
        
        // Fetch metadata from IGDB proxy
        this.gameService.getGameByTitle(rec.recommendedTitle).subscribe({
          next: (metadata) => {
            this.recommendedGameMetadata.set(metadata);
            this.appState.set('reveal');
          },
          error: (err) => {
            console.error('Metadata proxy search failed, using fallback:', err);
            this.recommendedGameMetadata.set({
              id: 0,
              name: rec.recommendedTitle,
              coverUrl: 'https://placehold.co/600x800/1e1e24/ff007f?text=No+Cover+Art',
              summary: 'Real-time IGDB metadata matching failed for this title.',
              genres: [],
              platforms: [],
            });
            this.appState.set('reveal');
          },
        });
      },
      error: (err) => {
        console.error('Error getting recommendation:', err);
        this.errorMessage.set('Failed to generate game recommendations. Please try again.');
        this.appState.set('quiz');
      },
    });
  }

  protected startOver() {
    this.selectedGames.set([null, null, null]);
    this.quizQuestions.set([]);
    this.quizAnswers.set([null, null, null, null, null]);
    this.recommendedGameMetadata.set(null);
    this.appState.set('landing');
  }
}
