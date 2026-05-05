import React from "react";

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          Algo salió mal: {this.state.error?.message || "error inesperado"}
        </div>
      );
    }
    return this.props.children;
  }
}
