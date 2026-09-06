import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types/index.js';
import { ApiClient } from '../api/client.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('bytestore_access_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('bytestore_access_token');
      if (storedToken) {
        try {
          const res = await ApiClient.get<{ success: boolean; user: User }>('/api/v1/auth/me');
          setUser(res.user);
        } catch {
          localStorage.removeItem('bytestore_access_token');
          localStorage.removeItem('bytestore_refresh_token');
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await ApiClient.post<{ success: boolean; tokens: { accessToken: string; refreshToken: string }; user: User }>('/api/v1/auth/login', {
      email,
      password: pass,
    });
    localStorage.setItem('bytestore_access_token', res.tokens.accessToken);
    localStorage.setItem('bytestore_refresh_token', res.tokens.refreshToken);
    setToken(res.tokens.accessToken);
    setUser(res.user);
  };

  const register = async (name: string, email: string, pass: string) => {
    const res = await ApiClient.post<{ success: boolean; tokens: { accessToken: string; refreshToken: string }; user: User }>('/api/v1/auth/register', {
      name,
      email,
      password: pass,
    });
    localStorage.setItem('bytestore_access_token', res.tokens.accessToken);
    localStorage.setItem('bytestore_refresh_token', res.tokens.refreshToken);
    setToken(res.tokens.accessToken);
    setUser(res.user);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('bytestore_refresh_token');
    if (refreshToken) {
      await ApiClient.post('/api/v1/auth/logout', { refreshToken }).catch(() => {});
    }
    localStorage.removeItem('bytestore_access_token');
    localStorage.removeItem('bytestore_refresh_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
