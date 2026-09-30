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

export function claimsFor(role: UserRole, teacherId: string | null): Record<string, string> {
  if (role === 'NONE') return {};
  return teacherId ? { role, teacherId } : { role };
}
