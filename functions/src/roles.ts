export type UserRole = 'ADMIN' | 'TEACHER' | 'NONE';

export function parseEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** 관리자면 ADMIN, 교사 명단에 이메일이 있으면 TEACHER, 둘 다 아니면 NONE */
export function resolveRole(isAdmin: boolean, teacherId: string | null): UserRole {
  if (isAdmin) return 'ADMIN';
  return teacherId ? 'TEACHER' : 'NONE';
}

/** 교사가 속한 학교·학기 (보안 규칙이 같은 학교·학기 자료만 읽게 하는 데 쓴다) */
export interface TermClaim {
  term: string;
  school: string;
  year: number;
  semester: number;
}

export function claimsFor(role: UserRole, teacherId: string | null, term: TermClaim | null = null): Record<string, string | number> {
  if (role === 'NONE') return {};
  if (!teacherId) return { role };
  return term ? { role, teacherId, ...term } : { role, teacherId };
}
