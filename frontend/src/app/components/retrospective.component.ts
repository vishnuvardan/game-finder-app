import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameService, IGDBGame } from '../services/game.service';
import { AutocompleteInput } from './autocomplete-input';
import html2canvas from 'html2canvas';

type RetroState = 'intake' | 'generating' | 'finalizing' | 'rating' | 'preview';

interface StarLabelMap {
  [key: number]: string;
}

const DEFAULT_STAR_LABELS: StarLabelMap = {
  1: 'Frustratingly bad design.',
  2: 'Skill issue? Nah, but the game is to blame.',
  3: 'Good for some, boring for me.',
  4: 'Good but can be improved.',
  5: "Absolute Cinema.",
};

@Component({
  selector: 'app-retrospective',
  standalone: true,
  imports: [CommonModule, FormsModule, AutocompleteInput],
  templateUrl: './retrospective.component.html',
  styleUrl: './retrospective.component.css',
})
export class RetrospectiveComponent {
  // Navigation & Page State
  protected readonly state = signal<RetroState>('intake');
  protected readonly errorMessage = signal<string | null>(null);

  // Form inputs
  protected readonly reviewerName = signal<string>('');
  protected readonly selectedGame = signal<IGDBGame | null>(null);

  // AI-generated metrics & user reviews
  protected readonly departments = signal<string[]>([]);
  protected readonly starLabels = signal<StarLabelMap>({ ...DEFAULT_STAR_LABELS });
  protected readonly ratings = signal<{ [dept: string]: number }>({});
  protected readonly hoveredStars = signal<{ [dept: string]: number }>({});
  protected readonly reviewDraft = signal<string>('');
  protected readonly isCopied = signal<boolean>(false);
  protected readonly reviewDraftError = signal<string | null>(null);
  protected readonly isFinalizingDraft = signal<boolean>(false);

  // Computed average rating and label out of 10 for the Instagram card
  protected readonly averageRating10 = computed(() => {
    const depts = this.departments();
    const currentRatings = this.ratings();
    if (depts.length === 0) return 0;
    const sum = depts.reduce((acc, dept) => acc + (currentRatings[dept] || 0), 0);
    const avg = sum / depts.length;
    const score = avg * 2;
    return Math.round(score * 10) / 10;
  });

  protected readonly averageRatingLabel = computed(() => {
    const score = this.averageRating10();
    if (score >= 9.5) return 'MASTERPIECE';
    if (score >= 8.5) return 'AMAZING';
    if (score >= 7.5) return 'GREAT';
    if (score >= 6.5) return 'GOOD';
    if (score >= 5.5) return 'OKAY';
    if (score >= 4.5) return 'MEDIOCRE';
    if (score >= 3.5) return 'BAD';
    if (score >= 2.5) return 'AWFUL';
    if (score >= 1.5) return 'PAINFUL';
    return 'UNBEARABLE';
  });

  // Computed state validations
  protected readonly isGenerateEnabled = computed(() => {
    return this.reviewerName().trim().length > 0 && this.selectedGame() !== null;
  });

  protected readonly isFinalizeEnabled = computed(() => {
    const currentDepts = this.departments();
    const currentRatings = this.ratings();
    if (currentDepts.length === 0) return false;
    return currentDepts.every((dept) => typeof currentRatings[dept] === 'number' && currentRatings[dept] > 0);
  });

  constructor(private gameService: GameService) { }

  protected onGameSelected(game: IGDBGame | null) {
    this.selectedGame.set(game);
  }

  protected generateReviewSheet() {
    if (!this.isGenerateEnabled()) return;

    const game = this.selectedGame()!;
    this.state.set('generating');
    this.errorMessage.set(null);

    this.gameService.generateRetrospectiveDepartments(game.name, game.genres).subscribe({
      next: (res) => {
        if (!res.departments || res.departments.length === 0) {
          this.errorMessage.set('AI returned an empty review sheet. Please try again.');
          this.state.set('intake');
          return;
        }
        this.departments.set(res.departments);
        if (res.starLabels) {
          this.starLabels.set(res.starLabels);
        }

        // Initialize ratings and hover values
        const initialRatings: { [dept: string]: number } = {};
        const initialHover: { [dept: string]: number } = {};
        res.departments.forEach((dept) => {
          initialRatings[dept] = 0;
          initialHover[dept] = 0;
        });
        this.ratings.set(initialRatings);
        this.hoveredStars.set(initialHover);

        this.state.set('rating');
      },
      error: (err) => {
        console.error('Error generating retrospective departments:', err);
        this.errorMessage.set('Failed to generate review criteria. Make sure the backend is running.');
        this.state.set('intake');
      },
    });
  }

  // Star Rating helpers
  protected getStarLabel(ratingValue: number): string {
    return this.starLabels()[ratingValue] || '';
  }

  protected getActiveLabel(dept: string): string {
    const hoverVal = this.hoveredStars()[dept];
    const ratedVal = this.ratings()[dept];
    const activeVal = hoverVal > 0 ? hoverVal : ratedVal;
    return this.getStarLabel(activeVal);
  }

  protected setHover(dept: string, val: number) {
    const current = { ...this.hoveredStars() };
    current[dept] = val;
    this.hoveredStars.set(current);
  }

  protected clearHover(dept: string) {
    const current = { ...this.hoveredStars() };
    current[dept] = 0;
    this.hoveredStars.set(current);
  }

  protected selectRating(dept: string, val: number) {
    const current = { ...this.ratings() };
    current[dept] = val;
    this.ratings.set(current);
  }

  protected finalizeCard() {
    if (!this.isFinalizeEnabled()) return;
    this.state.set('finalizing');
    this.errorMessage.set(null);
    this.reviewDraftError.set(null);
    this.reviewDraft.set('');

    const formattedRatings = this.departments().map((dept) => ({
      department: dept,
      stars: this.ratings()[dept],
      label: this.getStarLabel(this.ratings()[dept]),
    }));

    this.gameService.finalizeRetrospective(
      this.reviewerName(),
      this.selectedGame()!.name,
      formattedRatings
    ).subscribe({
      next: (res) => {
        this.reviewDraft.set(res.reviewDraft);
        this.state.set('preview');
      },
      error: (err) => {
        console.error('Error finalizing retrospective review:', err);
        this.reviewDraftError.set('The Gemini model is currently experiencing high demand and could not generate a review draft. Please try again.');
        this.state.set('preview');
      },
    });
  }

  protected retryFinalizeReview() {
    this.isFinalizingDraft.set(true);
    this.reviewDraftError.set(null);
    this.errorMessage.set(null);

    const formattedRatings = this.departments().map((dept) => ({
      department: dept,
      stars: this.ratings()[dept],
      label: this.getStarLabel(this.ratings()[dept]),
    }));

    this.gameService.finalizeRetrospective(
      this.reviewerName(),
      this.selectedGame()!.name,
      formattedRatings
    ).subscribe({
      next: (res) => {
        this.reviewDraft.set(res.reviewDraft);
        this.isFinalizingDraft.set(false);
      },
      error: (err) => {
        console.error('Error retrying retrospective review:', err);
        this.reviewDraftError.set('Model is still busy or quota has been reached. Please wait a moment and try again.');
        this.isFinalizingDraft.set(false);
      },
    });
  }

  protected copyReviewText() {
    const text = this.reviewDraft();
    if (!text) return;

    // Sanitize text to avoid carriage return and formatting paste bugs in Instagram Web
    const sanitizedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    navigator.clipboard.writeText(sanitizedText).then(() => {
      this.isCopied.set(true);
      setTimeout(() => this.isCopied.set(false), 2000);
    }).catch((err) => {
      console.error('Failed to copy to clipboard:', err);
      this.errorMessage.set('Failed to copy text to clipboard. You can select and copy it manually.');
    });
  }

  protected downloadShareCard() {
    const cardElement = document.getElementById('review-share-card');
    if (!cardElement) {
      this.errorMessage.set('Card container element not found.');
      return;
    }

    this.errorMessage.set(null);

    // Options configuration to make sure CORS works for external images
    const options = {
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: null,
      scale: 2, // High resolution download
    };

    html2canvas(cardElement, options)
      .then((canvas) => {
        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const fileNameSafeGameName = (this.selectedGame()?.name || 'Game')
          .replace(/[^a-z0-9]/gi, '_')
          .toLowerCase();
        link.download = `${fileNameSafeGameName}-review.png`;
        link.href = imgData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch((error) => {
        console.error('Screenshot generation failed:', error);
        this.errorMessage.set('Could not generate download image. Ensure all assets are loaded securely.');
      });
  }

  protected downloadInstagramPost() {
    const cardElement = document.getElementById('instagram-share-card');
    if (!cardElement) {
      this.errorMessage.set('Instagram post container element not found.');
      return;
    }

    this.errorMessage.set(null);

    const options = {
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: null,
      scale: 2, // High resolution download
    };

    html2canvas(cardElement, options)
      .then((canvas) => {
        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        const fileNameSafeGameName = (this.selectedGame()?.name || 'Game')
          .replace(/[^a-z0-9]/gi, '_')
          .toLowerCase();
        link.download = `${fileNameSafeGameName}-instagram.png`;
        link.href = imgData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      })
      .catch((error) => {
        console.error('Instagram screenshot generation failed:', error);
        this.errorMessage.set('Could not generate download image. Ensure all assets are loaded securely.');
      });
  }

  protected startOver() {
    this.reviewerName.set('');
    this.selectedGame.set(null);
    this.departments.set([]);
    this.starLabels.set({ ...DEFAULT_STAR_LABELS });
    this.ratings.set({});
    this.hoveredStars.set({});
    this.reviewDraft.set('');
    this.isCopied.set(false);
    this.reviewDraftError.set(null);
    this.isFinalizingDraft.set(false);
    this.errorMessage.set(null);
    this.state.set('intake');
  }
}
