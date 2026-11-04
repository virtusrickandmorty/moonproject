/** A screen that breaks while drawing shows a plain message inside the shell, instead of blanking the whole app. */
import { Component, type ReactNode } from 'react';
import { Button, Notice } from './ui.tsx';

export class ScreenGuard extends Component<{ children: ReactNode }, { broken: boolean }> {
  override state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  override render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="space-y-3">
        <Notice>This screen ran into a problem. What was already recorded is safe; what was being typed here was not saved.</Notice>
        <Button onClick={() => location.reload()}>Reload the page</Button>
      </div>
    );
  }
}
