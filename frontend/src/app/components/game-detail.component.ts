import { Component, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GameService, SteamAchievement, TrophyGuide } from '../services/game.service';
import { forkJoin, Subscription } from 'rxjs';

@Component({
  selector: 'app-game-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './game-detail.component.html',
  styleUrl: './game-detail.component.css',
})
export class GameDetailComponent implements OnInit, OnDestroy {
  protected readonly gameId = signal<string | null>(null);
  protected readonly gameName = signal<string>('Game Details');
  protected readonly gameImage = signal<string>('');
  protected readonly achievements = signal<SteamAchievement[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly pageError = signal<string | null>(null);

  // Guide Drawer states
  protected readonly selectedAchievement = signal<SteamAchievement | null>(null);
  protected readonly activeGuide = signal<TrophyGuide | null>(null);
  protected readonly isLoadingGuide = signal(false);
  protected readonly guideError = signal<string | null>(null);
  protected readonly isDrawerOpen = signal(false);

  private routeSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private gameService: GameService
  ) {}

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const appid = params.get('appid');
      if (appid) {
        this.gameId.set(appid);
        this.loadGameData(appid);
      } else {
        this.pageError.set('No Steam AppID provided in the URL.');
        this.isLoading.set(false);
      }
    });
  }

  ngOnDestroy() {
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
  }

  private loadGameData(appid: string) {
    this.isLoading.set(true);
    this.pageError.set(null);

    forkJoin({
      details: this.gameService.getGameDetailsSteam(appid),
      achievements: this.gameService.getGameAchievements(appid)
    }).subscribe({
      next: (res) => {
        this.gameName.set(res.details.name);
        this.gameImage.set(res.details.background_image);
        this.achievements.set(res.achievements);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading game achievements:', err);
        const errMsg = err.error?.error || 'Failed to load achievements. Please check your network connection.';
        this.pageError.set(errMsg);
        this.isLoading.set(false);
      }
    });
  }

  protected selectAchievement(ach: SteamAchievement) {
    this.selectedAchievement.set(ach);
    this.isDrawerOpen.set(true);
    this.fetchGuide(ach);
  }

  private fetchGuide(ach: SteamAchievement) {
    this.isLoadingGuide.set(true);
    this.guideError.set(null);
    this.activeGuide.set(null);

    this.gameService.generateTrophyGuide(this.gameName(), ach.displayName, ach.description || '').subscribe({
      next: (guide) => {
        this.activeGuide.set(guide);
        this.isLoadingGuide.set(false);
      },
      error: (err) => {
        console.error('Error generating trophy guide:', err);
        this.guideError.set('Failed to generate tactical walkthrough. The AI may be busy or rate-limited.');
        this.isLoadingGuide.set(false);
      }
    });
  }

  protected retryGuideGeneration() {
    const ach = this.selectedAchievement();
    if (ach) {
      this.fetchGuide(ach);
    }
  }

  protected closeDrawer() {
    this.isDrawerOpen.set(false);
    // Let the CSS transition finish before clearing content signals
    setTimeout(() => {
      if (!this.isDrawerOpen()) {
        this.selectedAchievement.set(null);
        this.activeGuide.set(null);
        this.guideError.set(null);
      }
    }, 300);
  }
}
