import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '../ErrorBoundary';

// Suppress console.error output during tests since we intentionally trigger errors
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

const ThrowingComponent: React.FC<{ message?: string }> = ({ message = 'Test error' }) => {
  throw new Error(message);
};

const GoodComponent: React.FC = () => <div>Working content</div>;

describe('ErrorBoundary', () => {
  it('should render children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Working content')).toBeInTheDocument();
  });

  it('should render error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
    expect(screen.getByText('Go Back')).toBeInTheDocument();
  });

  it('should display the error message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Custom failure" />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Custom failure/)).toBeInTheDocument();
  });

  it('should render the Reload Page button as primary action', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    const reloadButton = screen.getByText('Reload Page');
    expect(reloadButton).toBeInTheDocument();
    expect(reloadButton.closest('button')).not.toBeDisabled();
  });

  it('should call window.history.back when Go Back is clicked', async () => {
    const backMock = jest.fn();
    jest.spyOn(window.history, 'back').mockImplementation(backMock);

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByText('Go Back'));
    expect(backMock).toHaveBeenCalled();
  });

  it('should reset error state when key changes', () => {
    const { rerender } = render(
      <ErrorBoundary key="a">
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="b">
        <GoodComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Working content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('should log the error via console.error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Logged error" />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });
});
