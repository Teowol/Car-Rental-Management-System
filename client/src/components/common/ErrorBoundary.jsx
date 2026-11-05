import { Component, createRef } from 'react';

export default class ErrorBoundary extends Component {
  state = { failed: false };
  panel = createRef();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.panel.current?.focus(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="state-panel error-boundary" role="alert" tabIndex="-1" ref={this.panel}>
      <h1>Something went wrong</h1><p>We could not display this page. If you were making a booking or payment, check its history before trying again.</p>
      <div className="action-buttons"><button onClick={() => window.location.reload()}>Reload page</button>{!this.props.root && <a href="#/">Back to catalog</a>}</div>
    </section>;
  }
}
