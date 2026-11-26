"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Table3DErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError?: () => void;
}

interface Table3DErrorBoundaryState {
  hasError: boolean;
}

export class Table3DErrorBoundary extends Component<
  Table3DErrorBoundaryProps,
  Table3DErrorBoundaryState
> {
  state: Table3DErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): Table3DErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[GDArena 3D] Scene crashed, falling back to 2D:", error, info);
    this.props.onError?.();
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

