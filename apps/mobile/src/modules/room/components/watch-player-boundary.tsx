import { Component, type ErrorInfo, type ReactNode } from 'react';

export class WatchPlayerBoundary extends Component<
  { readonly children: ReactNode; readonly onFailure: () => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    this.props.onFailure();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
