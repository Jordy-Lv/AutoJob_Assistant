import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button/Button";
import styles from "./ErrorBoundary.module.css";

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.wrap} role="alert">
          <div className={styles.icon}>
            <AlertTriangle size={26} aria-hidden="true" />
          </div>
          <h1>Algo salio mal en esta vista</h1>
          <p>{this.state.error?.message || "Error inesperado al renderizar la pantalla."}</p>
          <Button icon={RefreshCw} onClick={this.reset} variant="secondary">
            Reintentar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
