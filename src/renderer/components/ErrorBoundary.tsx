import { Component, ReactNode } from 'react'

interface State {
  failed: boolean
}

// Isolates tab crashes so one broken view can't kill the whole overlay.
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(err: unknown) {
    console.error(`[overlay] ${this.props.name} crashed:`, err)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="hotkey-hint">
          {this.props.name} view crashed. Switch tabs and come back, or restart the overlay.
        </div>
      )
    }
    return this.props.children
  }
}
