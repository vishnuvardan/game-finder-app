import { Routes } from '@angular/router';
import { MatchmakerComponent } from './components/matchmaker.component';
import { RetrospectiveComponent } from './components/retrospective.component';

export const routes: Routes = [
  { path: '', component: MatchmakerComponent },
  { path: 'retrospective', component: RetrospectiveComponent },
  { path: '**', redirectTo: '' },
];
