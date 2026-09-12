import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { failed: true, message: error?.message || 'Something unexpected happened.' };
  }

  componentDidCatch(error) {
    console.error('HerHealth UI error:', error);
  }

  reset = () => {
    this.setState({ failed: false, message: '' });
  };

  render() {
    if (this.state.failed) {
      return <div className="page-wrap">
        <div className="empty-state error-state" role="alert">
          <div className="empty-flower" aria-hidden="true">!</div>
          <h3>Something unexpected happened</h3>
          <p>{this.state.message} You can safely try again.</p>
          <button className="primary-button" onClick={this.reset}>Reload this view</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}
