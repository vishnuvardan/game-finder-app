import { Routes } from '@angular/router';
import { MatchmakerComponent } from './components/matchmaker.component';
import { RetrospectiveComponent } from './components/retrospective.component';
import { TrophySearchComponent } from './components/trophy-search.component';
import { GameDetailComponent } from './components/game-detail.component';
import { CarouselCreatorComponent } from './components/carousel-creator.component';
import { ShortsCreatorComponent } from './components/shorts-creator.component';

export const routes: Routes = [
  { path: '', component: TrophySearchComponent },
  { path: 'matchmaker', component: MatchmakerComponent },
  { path: 'retrospective', component: RetrospectiveComponent },
  { path: 'search', redirectTo: '' },
  { path: 'game/:appid', component: GameDetailComponent },
  { path: 'carousel', component: CarouselCreatorComponent },
  { path: 'shorts', component: ShortsCreatorComponent },
  { path: '**', redirectTo: '' },
];
