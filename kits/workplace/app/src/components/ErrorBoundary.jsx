// A crash in one panel is that panel's problem. Without this, one undefined component blanks
// the whole page and the person has no idea what happened; with it, the panel says so and the
// rest of the room keeps working.
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[workplace]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wp-crash" role="alert">
        <strong>{this.props.label || 'This part'} could not be shown.</strong>
        <div className="wp-crash-msg">{String(this.state.error?.message || this.state.error)}</div>
        <button type="button" className="uic-btn is-default is-sm" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
