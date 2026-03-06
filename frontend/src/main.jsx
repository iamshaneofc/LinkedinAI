import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import axios from 'axios'

// Set base URL for API requests
// In development, this falls back to localhost (match backend PORT; backend default is 3000)
// Set VITE_API_URL to override (e.g. http://localhost:5000 if backend runs on 5000)
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

import { ToastProvider, useToast } from './components/ui/toast.jsx'

// Global error handler component
function ErrorHandler({ children }) {
    const { addToast } = useToast();

    React.useEffect(() => {
        // Response interceptor to catch all API errors
        const interceptor = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                // Do not show toast or log for canceled/aborted requests (e.g. AbortController, nav away)
                const isCanceled =
                    axios.isCancel(error) ||
                    error?.name === 'AbortError' ||
                    error?.code === 'ERR_CANCELED' ||
                    (error?.message && String(error.message).toLowerCase() === 'canceled');
                if (isCanceled) {
                    return Promise.reject(error);
                }

                // Extract error message
                const errorMessage = error.response?.data?.error ||
                    error.response?.data?.message ||
                    error.message ||
                    'An unexpected error occurred';

                // Log to console only when not skipped (e.g. notification poll uses skipGlobalErrorHandler to avoid noise)
                if (!error.config?.skipGlobalErrorHandler) {
                    console.error('🔴 API Error:', {
                        url: error.config?.url,
                        method: error.config?.method,
                        status: error.response?.status,
                        message: errorMessage,
                        fullError: error
                    });
                }

                // Show error in UI (only if not already handled by component)
                if (!error.config?.skipGlobalErrorHandler) {
                    // Don't show errors for 401/403 (auth) - let components handle those
                    if (error.response?.status !== 401 && error.response?.status !== 403) {
                        // Format error message (skip status prefix when we have a friendly message + link)
                        const helpUrl = error.response?.data?.helpUrl;
                        let displayMessage = errorMessage;
                        if (error.response?.status && !helpUrl) {
                            displayMessage = `[${error.response.status}] ${errorMessage}`;
                        }
                        addToast(displayMessage, 'error', helpUrl ? { helpUrl } : {});
                    }
                }

                return Promise.reject(error);
            }
        );

        return () => {
            axios.interceptors.response.eject(interceptor);
        };
    }, [addToast]);

    return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter>
            <ToastProvider>
                <ErrorHandler>
                    <App />
                </ErrorHandler>
            </ToastProvider>
        </BrowserRouter>
    </React.StrictMode>,
)
