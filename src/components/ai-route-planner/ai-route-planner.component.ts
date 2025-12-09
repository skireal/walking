import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService, RouteSuggestion } from '../../services/gemini.service';

type ViewState = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-ai-route-planner',
  templateUrl: './ai-route-planner.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule]
})
export class AiRoutePlannerComponent {
  private geminiService = inject(GeminiService);

  location = signal('');
  duration = signal(30);
  viewState = signal<ViewState>('idle');
  suggestion = signal<RouteSuggestion | null>(null);
  error = signal<string | null>(null);
  loadingMessage = signal('Planning your walk...');

  async generateRoute() {
    if (!this.location().trim()) {
      this.error.set('Please enter a starting location.');
      return;
    }

    this.viewState.set('loading');
    this.suggestion.set(null);
    this.error.set(null);
    this.loadingMessage.set('✨ Our AI is designing your route...');

    try {
      const result = await this.geminiService.getRouteSuggestion(this.location(), this.duration());
      this.suggestion.set(result);
      this.viewState.set('success');
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      this.error.set(errorMessage);
      this.viewState.set('error');
    }
  }

  startOver() {
    this.viewState.set('idle');
    this.suggestion.set(null);
    this.error.set(null);
  }
}