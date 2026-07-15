import { Routes } from '@angular/router';
import { MatchmakerComponent } from './components/matchmaker.component';
import { RetrospectiveComponent } from './components/retrospective.component';
import { TrophySearchComponent } from './components/trophy-search.component';
import { GameDetailComponent } from './components/game-detail.component';

export const routes: Routes = [
  { path: '', component: MatchmakerComponent },
  { path: 'retrospective', component: RetrospectiveComponent },
  { path: 'search', component: TrophySearchComponent },
  { path: 'game/:appid', component: GameDetailComponent },
  { path: '**', redirectTo: '' },
];
