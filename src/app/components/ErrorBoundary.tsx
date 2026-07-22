import React from 'react';
import {
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Button,
  PageSection,
} from '@patternfly/react-core';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoBack = (): void => {
    this.setState({ hasError: false, error: null });
    window.history.back();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <PageSection>
          <EmptyState
            headingLevel="h2"
            titleText="Something went wrong"
            icon={ExclamationTriangleIcon}
          >
            <EmptyStateBody>
              An unexpected error occurred while rendering this page.
              {this.state.error?.message && (
                <>
                  <br />
                  <br />
                  <strong>Error:</strong> {this.state.error.message}
                </>
              )}
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={this.handleReload}>
                  Reload Page
                </Button>
                <Button variant="link" onClick={this.handleGoBack}>
                  Go Back
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        </PageSection>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
