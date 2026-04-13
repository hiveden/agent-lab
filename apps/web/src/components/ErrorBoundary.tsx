'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 bg-[var(--bg)] text-[var(--text)]">
          <h2 className="text-lg font-semibold">出错了</h2>
          <pre className="text-xs text-[var(--text-3)] max-w-md whitespace-pre-wrap text-center">
            {this.state.error.message}
          </pre>
          <button
            className="px-4 py-1.5 text-sm bg-[var(--accent)] text-white rounded-md"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
