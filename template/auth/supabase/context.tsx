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

  const setAuthenticatedUser = (user: AuthUser) => {
    updateState({ user, loading: false, initialized: true });
  };

  useEffect(() => {
    let isMounted = true;
    let authEventReceived = false;

    const authSubscription = authService.onAuthStateChange((authUser) => {
      authEventReceived = true;
      if (isMounted) updateState({ user: authUser });
    });

    const initializeAuth = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (isMounted) {
          const sessionUpdate = authEventReceived ? {} : { user: currentUser };
          updateState({ ...sessionUpdate, loading: false, initialized: true });
        }
      } catch (error) {
        console.warn('[Template:AuthProvider] Auth initialization failed:', error);
        if (isMounted) {
          const sessionUpdate = authEventReceived ? {} : { user: null };
          updateState({ ...sessionUpdate, loading: false, initialized: true });
        }
      }
    };

    void initializeAuth();
    return () => {
      isMounted = false;
      authSubscription?.unsubscribe?.();
    };
  }, []);

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