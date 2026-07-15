import { Component, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter, switchMap, tap, catchError, of, Subscription } from 'rxjs';
import { GameService, RAWGGame } from '../services/game.service';

@Component({
  selector: 'app-trophy-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './trophy-search.component.html',
  styleUrl: './trophy-search.component.css',
})
export class TrophySearchComponent implements OnInit, OnDestroy {
  protected readonly searchControl = new FormControl('');
  protected readonly suggestions = signal<RAWGGame[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private searchSub?: Subscription;

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit() {
    this.searchSub = this.searchControl.valueChanges
      .pipe(
        tap((value) => {
          this.errorMessage.set(null);
          if (!value || value.trim().length < 3) {
            this.suggestions.set([]);
            this.isLoading.set(false);
            return;
          }
          this.isLoading.set(true);
        }),
        debounceTime(350),
        distinctUntilChanged(),
        filter((value): value is string => value !== null && value.trim().length >= 3),
        switchMap((value) => {
          return this.gameService.searchGamesRawg(value).pipe(
            catchError((error) => {
              console.error('Search error:', error);
              this.errorMessage.set('Failed to retrieve games. Please try again.');
              this.isLoading.set(false);
              return of([]);
            })
          );
        }),
        tap((results) => {
          this.suggestions.set(results);
          this.isLoading.set(false);
        })
      )
      .subscribe();
  }

  ngOnDestroy() {
    if (this.searchSub) {
      this.searchSub.unsubscribe();
    }
  }

  protected selectGame(game: RAWGGame) {
    this.router.navigate(['/game', game.id]);
  }
}
