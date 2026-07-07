import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError, of } from 'rxjs';
import { GameService, IGDBGame } from '../services/game.service';

@Component({
  selector: 'app-autocomplete-input',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './autocomplete-input.html',
  styleUrl: './autocomplete-input.css',
})
export class AutocompleteInput implements OnInit {
  @Input() label: string = 'Select a Game';
  @Input() placeholder: string = 'Search for a game...';
  @Output() gameSelected = new EventEmitter<IGDBGame | null>();

  @Input() set selectedValue(game: IGDBGame | null) {
    this.selectedGame.set(game);
    if (game) {
      this.searchControl.setValue(game.name, { emitEvent: false });
    } else {
      this.searchControl.setValue('', { emitEvent: false });
    }
    this.activeSuggestionIndex.set(-1);
  }

  protected readonly searchControl = new FormControl('');
  protected readonly suggestions = signal<IGDBGame[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly showSuggestions = signal(false);
  protected readonly selectedGame = signal<IGDBGame | null>(null);
  protected readonly activeSuggestionIndex = signal<number>(-1);

  constructor(private gameService: GameService) {}

  ngOnInit() {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((value) => {
          // If the user manually edits and clears the field or changes text, clear selected game
          if (this.selectedGame() && value !== this.selectedGame()?.name) {
            this.selectedGame.set(null);
            this.gameSelected.emit(null);
          }
          
          if (!value || value.trim().length < 2) {
            this.suggestions.set([]);
            this.isLoading.set(false);
            this.activeSuggestionIndex.set(-1);
            return;
          }
          this.isLoading.set(true);
          this.showSuggestions.set(true);
          this.activeSuggestionIndex.set(-1);
        }),
        switchMap((value) => {
          if (!value || value.trim().length < 2 || this.selectedGame()) {
            return of([]);
          }
          return this.gameService.searchGames(value).pipe(
            catchError((error) => {
              console.error('Autocomplete search error:', error);
              return of([]);
            })
          );
        }),
        tap((results) => {
          this.suggestions.set(results);
          this.isLoading.set(false);
          this.activeSuggestionIndex.set(-1);
        })
      )
      .subscribe();
  }

  protected selectGame(game: IGDBGame) {
    this.selectedGame.set(game);
    this.searchControl.setValue(game.name, { emitEvent: false });
    this.suggestions.set([]);
    this.showSuggestions.set(false);
    this.activeSuggestionIndex.set(-1);
    this.gameSelected.emit(game);
  }

  protected clearSelection() {
    this.selectedGame.set(null);
    this.searchControl.setValue('', { emitEvent: true });
    this.suggestions.set([]);
    this.showSuggestions.set(false);
    this.activeSuggestionIndex.set(-1);
    this.gameSelected.emit(null);
  }

  protected onBlur() {
    // Hide suggestions after short delay so clicks on suggestions can register
    setTimeout(() => {
      this.showSuggestions.set(false);
      this.activeSuggestionIndex.set(-1);
    }, 200);
  }

  protected onFocus() {
    if (this.searchControl.value && this.searchControl.value.trim().length >= 2 && !this.selectedGame()) {
      this.showSuggestions.set(true);
      this.activeSuggestionIndex.set(-1);
    }
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (!this.showSuggestions() || this.suggestions().length === 0) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeSuggestionIndex.set(
          (this.activeSuggestionIndex() + 1) % this.suggestions().length
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeSuggestionIndex.set(
          (this.activeSuggestionIndex() - 1 + this.suggestions().length) % this.suggestions().length
        );
        break;
      case 'Enter':
        if (this.activeSuggestionIndex() >= 0 && this.activeSuggestionIndex() < this.suggestions().length) {
          event.preventDefault();
          this.selectGame(this.suggestions()[this.activeSuggestionIndex()]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.showSuggestions.set(false);
        this.activeSuggestionIndex.set(-1);
        break;
    }
  }
}
