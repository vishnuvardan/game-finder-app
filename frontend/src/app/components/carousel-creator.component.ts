import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameService, IGDBGame, CarouselSlide } from '../services/game.service';
import { AutocompleteInput } from './autocomplete-input';
import html2canvas from 'html2canvas';

type PageState = 'intake' | 'generating' | 'preview';
type AspectRatio = '4-5' | '9-16' | '1-1';
type SlideTheme = 'cyberpunk' | 'glass' | 'retro' | 'magazine' | 'ign' | 'kotaku' | 'polygon' | 'gamespot' | 'steam' | 'esports';

@Component({
  selector: 'app-carousel-creator',
  standalone: true,
  imports: [CommonModule, FormsModule, AutocompleteInput],
  templateUrl: './carousel-creator.component.html',
  styleUrl: './carousel-creator.component.css',
})
export class CarouselCreatorComponent {
  // Navigation & Page State
  protected readonly state = signal<PageState>('intake');
  protected readonly errorMessage = signal<string | null>(null);

  // Form inputs
  protected readonly selectedGame = signal<IGDBGame | null>(null);
  protected readonly customTopic = signal<string>('');
  protected readonly watermark = signal<string>('@GamerInsights');
  protected readonly aspectRatio = signal<AspectRatio>('4-5');
  protected readonly theme = signal<SlideTheme>('cyberpunk');

  // List of themes for the theme cycling switcher
  protected readonly themesList: { value: SlideTheme; label: string }[] = [
    { value: 'cyberpunk', label: 'Neon Cyberpunk' },
    { value: 'glass', label: 'Glassmorphic' },
    { value: 'retro', label: 'Retro Arcade' },
    { value: 'magazine', label: 'Magazine Print' },
    { value: 'ign', label: 'IGN Editorial' },
    { value: 'kotaku', label: 'Kotaku Grunge' },
    { value: 'polygon', label: 'Polygon Creative' },
    { value: 'gamespot', label: 'GameSpot Steel' },
    { value: 'steam', label: 'Steam Storefront' },
    { value: 'esports', label: 'Esports Arena' },
  ];

  // Generated slides state
  protected readonly slides = signal<CarouselSlide[]>([]);
  protected readonly activeSlideIndex = signal<number>(0);
  protected readonly isDownloading = signal<boolean>(false);
  protected readonly caption = signal<string>('');
  protected readonly isCopied = signal<boolean>(false);
  protected readonly generatedCoverUrl = signal<string | null>(null);

  protected readonly getCoverUrl = computed(() => {
    return this.generatedCoverUrl() || this.selectedGame()?.coverUrl || null;
  });

  protected readonly hasCoverImage = computed(() => {
    return this.getCoverUrl() !== null;
  });

  protected copyCaption() {
    const text = this.caption();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.isCopied.set(true);
      setTimeout(() => this.isCopied.set(false), 2000);
    });
  }

  // Computed state validations
  protected readonly isGenerateEnabled = computed(() => {
    return this.customTopic().trim().length > 0;
  });

  // Quick Chips
  protected readonly topicChips = [
    { label: '📰 Recent News', text: 'Recent news, updates, and community buzz' },
    { label: '🤫 Rumors & Leaks', text: 'Recent rumors, leaks, and potential future updates' },
    { label: '📈 Sales & Stats', text: 'Sales milestones, downloads, active player counts, and ratings' },
    { label: '📅 Release & Price', text: 'Release dates, platforms, prices, and value proposition' },
    { label: '💡 Fun Facts & Lore', text: 'Interesting trivia, easter eggs, and game lore' },
  ];

  constructor(private gameService: GameService) {}

  protected onGameSelected(game: IGDBGame | null) {
    this.selectedGame.set(game);
  }

  protected selectTopicChip(text: string) {
    this.customTopic.set(text);
  }

  protected selectTheme(selectedTheme: SlideTheme) {
    this.theme.set(selectedTheme);
  }

  protected getThemeLabel(): string {
    const currentTheme = this.theme();
    const found = this.themesList.find(t => t.value === currentTheme);
    return found ? found.label : currentTheme;
  }

  protected nextTheme() {
    const currentTheme = this.theme();
    const currentIndex = this.themesList.findIndex(t => t.value === currentTheme);
    const nextIndex = (currentIndex + 1) % this.themesList.length;
    this.theme.set(this.themesList[nextIndex].value);
  }

  protected prevTheme() {
    const currentTheme = this.theme();
    const currentIndex = this.themesList.findIndex(t => t.value === currentTheme);
    const prevIndex = (currentIndex - 1 + this.themesList.length) % this.themesList.length;
    this.theme.set(this.themesList[prevIndex].value);
  }

  protected readonly aspectRatiosList: { value: AspectRatio; label: string }[] = [
    { value: '4-5', label: 'Instagram Portrait (4:5)' },
    { value: '9-16', label: 'Story / Reels (9:16)' },
    { value: '1-1', label: 'Classic Square (1:1)' },
  ];

  protected selectAspectRatio(ratio: AspectRatio) {
    this.aspectRatio.set(ratio);
  }

  protected getAspectRatioLabel(): string {
    const currentRatio = this.aspectRatio();
    const found = this.aspectRatiosList.find(r => r.value === currentRatio);
    return found ? found.label : currentRatio;
  }

  protected nextAspectRatio() {
    const currentRatio = this.aspectRatio();
    const currentIndex = this.aspectRatiosList.findIndex(r => r.value === currentRatio);
    const nextIndex = (currentIndex + 1) % this.aspectRatiosList.length;
    this.aspectRatio.set(this.aspectRatiosList[nextIndex].value);
  }

  protected prevAspectRatio() {
    const currentRatio = this.aspectRatio();
    const currentIndex = this.aspectRatiosList.findIndex(r => r.value === currentRatio);
    const prevIndex = (currentIndex - 1 + this.aspectRatiosList.length) % this.aspectRatiosList.length;
    this.aspectRatio.set(this.aspectRatiosList[prevIndex].value);
  }

  protected generateCarousel() {
    if (!this.isGenerateEnabled()) return;

    const game = this.selectedGame();
    const topic = this.customTopic();

    this.state.set('generating');
    this.errorMessage.set(null);
    this.slides.set([]);
    this.activeSlideIndex.set(0);
    this.generatedCoverUrl.set(null);

    const name = game ? game.name : undefined;
    const summary = game ? game.summary : undefined;
    const genres = game ? game.genres : undefined;

    this.gameService.generateSlides(name, summary, genres, topic).subscribe({
      next: (res) => {
        if (!res.slides || res.slides.length === 0) {
          this.errorMessage.set('AI returned empty slides content. Please try again.');
          this.state.set('intake');
          return;
        }
        this.slides.set(res.slides);
        this.caption.set(res.caption || '');
        this.generatedCoverUrl.set(res.coverImageUrl || null);
        this.state.set('preview');
      },
      error: (err) => {
        console.error('Error generating slides:', err);
        this.errorMessage.set('Failed to generate slides. Make sure the backend is running.');
        this.state.set('intake');
      },
    });
  }

  // Slide Navigation
  protected nextSlide() {
    if (this.slides().length === 0) return;
    this.activeSlideIndex.set((this.activeSlideIndex() + 1) % this.slides().length);
  }

  protected prevSlide() {
    if (this.slides().length === 0) return;
    this.activeSlideIndex.set(
      (this.activeSlideIndex() - 1 + this.slides().length) % this.slides().length
    );
  }

  protected goToSlide(index: number) {
    this.activeSlideIndex.set(index);
  }

  // Image exports
  private async triggerDownload(elementId: string, filename: string): Promise<boolean> {
    const cardElement = document.getElementById(elementId);
    if (!cardElement) {
      console.error(`Element not found for download: ${elementId}`);
      return false;
    }

    const options = {
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: null,
      scale: 3.375, // High-res export (320px * 3.375 = 1080px wide)
    };

    try {
      const canvas = await html2canvas(cardElement, options);
      const imgData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = filename;
      link.href = imgData;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (err) {
      console.error('HTML2Canvas rendering error:', err);
      return false;
    }
  }

  protected async downloadActiveSlide() {
    this.errorMessage.set(null);
    const gameName = this.selectedGame()?.name || 'game';
    const index = this.activeSlideIndex();
    const safeName = gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeName}-slide-${index + 1}.png`;

    const success = await this.triggerDownload('active-preview-card', filename);
    if (!success) {
      this.errorMessage.set('Failed to download active slide. Please ensure all assets are loaded.');
    }
  }

  protected async downloadAllSlides() {
    this.errorMessage.set(null);
    this.isDownloading.set(true);

    const gameName = this.selectedGame()?.name || 'game';
    const safeName = gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const totalSlides = this.slides().length;

    let successCount = 0;

    for (let i = 0; i < totalSlides; i++) {
      const elementId = `offscreen-slide-${i}`;
      const filename = `${safeName}-carousel-slide-${i + 1}.png`;
      
      // Delay slightly between downloads to prevent browser blocking multiple downloads
      await new Promise((resolve) => setTimeout(resolve, 300));
      const success = await this.triggerDownload(elementId, filename);
      if (success) successCount++;
    }

    this.isDownloading.set(false);

    if (successCount < totalSlides) {
      this.errorMessage.set(`Only downloaded ${successCount}/${totalSlides} slides successfully. Please try again.`);
    }
  }

  protected startOver() {
    this.selectedGame.set(null);
    this.customTopic.set('');
    this.slides.set([]);
    this.activeSlideIndex.set(0);
    this.caption.set('');
    this.generatedCoverUrl.set(null);
    this.errorMessage.set(null);
    this.state.set('intake');
  }
}
