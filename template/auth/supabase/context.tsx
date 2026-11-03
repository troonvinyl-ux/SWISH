// @ts-nocheck
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { AuthUser } from '../types';
import { authService } from './service';

interface AuthContextState {
  user: AuthUser | null;
  loading: boolean;
  operationLoading: boolean;
  initialized: boolean;
}

interface AuthContextActions {
  setOperationLoading: (loading: boolean) => void;
  setAuthenticatedUser: (user: AuthUser) => void;
}

type AuthContextType = AuthContextState & AuthContextActions;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthContextState>({
    user: null,
    loading: true,
    operationLoading: false,
    initialized: false,
  });

  const updateState = (updates: Partial<AuthContextState>) => {
    setState(prevState => {
      const newState = { ...prevState, ...updates };
      return newState;
    });
  };

  const setOperationLoading = (loading: boolean) => {
    updateState({ operationLoading: loading });
  };

  // Commit a confirmed sign-in result immediately. Navigation must not depend
  // exclusively on the SDK event listener being scheduled on the UI thread.
  const setAuthenticatedUser = (user: AuthUser) => {
    updateState({ user, loading: false, initialized: true });
  };

  useEffect(() => {
    let isMounted = true;
    let authSubscription: any = null;

    const initializeAuth = async () => {
      let authEventReceived = false;

      try {
        // Subscribe before reading the persisted session so a SIGNED_IN event
        // cannot be missed between getSession() and listener registration.
        authSubscription = authService.onAuthStateChange((authUser) => {
          authEventReceived = true;
          if (isMounted) {
            updateState({
              user: authUser,
              loading: false,
              initialized: true,
            });
          }
        });

        const currentUser = await authService.getCurrentUser();

        if (isMounted) {
          updateState({
            // An auth event is newer than the session snapshot started above.
            ...(authEventReceived ? {} : { user: currentUser }),
            loading: false,
            initialized: true,
          });
        }
      } catch (error) {
        console.warn('[Template:AuthProvider] Auth initialization failed:', error);
        if (isMounted) {
          updateState({
            user: null,
            loading: false,
            initialized: true,
          });
        }
      }
    };
    initializeAuth();

    return () => {
      isMounted = false;
      if (authSubscription?.unsubscribe) {
        authSubscription.unsubscribe();
      }
    };
  }, []); // Empty dependency array ensures single execution
  const contextValue: AuthContextType = {
    ...state,
    setOperationLoading,
    setAuthenticatedUser,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

// useAuthContext Hook - internal use
export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  
  return context;
}