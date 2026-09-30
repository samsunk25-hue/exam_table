import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, callSyncProfile, errorMessage, type Role } from '@/lib/firebase';

interface AuthState {
  loading: boolean;
  user: User | null;
  role: Role;
  teacherId: string | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'signIn' | 'signOut'>>({
    loading: true,
    user: null,
    role: 'NONE',
    teacherId: null,
    error: null,
  });

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setState({ loading: false, user: null, role: 'NONE', teacherId: null, error: null });
          return;
        }
        setState((s) => ({ ...s, loading: true }));
        try {
          // 서버에서 역할을 판정하고, 바뀌었으면 토큰을 갱신해 Custom Claims를 받는다.
          const { data } = await callSyncProfile();
          const token = await user.getIdTokenResult(data.refreshed);
          const role = (token.claims.role as Role | undefined) ?? 'NONE';
          const teacherId = (token.claims.teacherId as string | undefined) ?? null;
          setState({ loading: false, user, role, teacherId, error: null });
        } catch (e) {
          setState({ loading: false, user, role: 'NONE', teacherId: null, error: errorMessage(e) });
        }
      }),
    [],
  );

  const value: AuthState = {
    ...state,
    signIn: async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    },
    signOut: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider 안에서 사용해야 합니다.');
  return ctx;
}
