import React from 'react';

class ErrorBoundary extends React.Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        // Update state so the next render shows the fallback UI
        return { error };
    }

    componentDidCatch(error, errorInfo) {
        // Log error details for debugging
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="text-red-400 text-center p-4">
                    <p>Error rendering chart: {this.state.error.message}</p>
                    <p>Please try again or contact support.</p>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;