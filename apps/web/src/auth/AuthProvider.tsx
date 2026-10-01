import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TermRef } from '@sim/shared';
import { auth, callSyncProfile, errorMessage, type Role } from '@/lib/firebase';

interface AuthState {
  loading: boolean;
  user: User | null;
  role: Role;
  teacherId: string | null;
  /** 교사의 학교·학기 (보안 규칙상 이 학교·학기 자료만 읽을 수 있다) */
  term: TermRef | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 역할을 서버에서 다시 받아온다 (가입·권한 신청이 승인됐을 때) */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type State = Omit<AuthState, 'signIn' | 'signOut' | 'refresh'>;

/** 서버에서 역할을 판정하고, 바뀌었으면 토큰을 갱신해 Custom Claims를 받는다. */
async function loadRole(user: User): Promise<State> {
  try {
    const { data } = await callSyncProfile();
    const token = await user.getIdTokenResult(data.refreshed);
    const role = (token.claims.role as Role | undefined) ?? 'NONE';
    const teacherId = (token.claims.teacherId as string | undefined) ?? null;
    const c = token.claims as { school?: string; year?: number; semester?: number };
    const term = c.school && c.year && c.semester ? { school: c.school, year: c.year, semester: c.semester } : null;
    return { loading: false, user, role, teacherId, term, error: null };
  } catch (e) {
    return { loading: false, user, role: 'NONE', teacherId: null, term: null, error: errorMessage(e) };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ loading: true, user: null, role: 'NONE', teacherId: null, term: null, error: null });

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setState({ loading: false, user: null, role: 'NONE', teacherId: null, term: null, error: null });
          return;
        }
        setState((s) => ({ ...s, loading: true }));
        setState(await loadRole(user));
      }),
    [],
  );

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (user) setState(await loadRole(user));
  }, []);

  const value: AuthState = {
    ...state,
    signIn: async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    },
    signOut: () => signOut(auth),
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider 안에서 사용해야 합니다.');
  return ctx;
}
