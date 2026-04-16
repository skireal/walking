import { Component, ChangeDetectionStrategy, output, signal } from '@angular/core';

const STORAGE_KEY = 'walker_onboarding_seen';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  done = output<void>();

  step = signal(0);

  readonly steps = [
    {
      icon: 'fog',
      title: 'Your world is hidden',
      body: 'The map starts covered in fog. Walk around to reveal it.',
    },
    {
      icon: 'walk',
      title: 'Every step counts',
      body: 'Open new tiles just by going outside. No goals, no pressure — just explore.',
    },
    {
      icon: 'map',
      title: 'Make it yours',
      body: 'Over time your map becomes a picture of everywhere you\'ve ever been.',
    },
  ];

  next(): void {
    if (this.step() < this.steps.length - 1) {
      this.step.update(s => s + 1);
    } else {
      this.finish();
    }
  }

  finish(): void {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch { /* ignore */ }
    this.done.emit();
  }
}
