import type { DefaultRole, Homeroom } from '../model';
import { finish, flagDuplicates, readRows, type Cell, type ColumnMapping, type FieldDef, type ImportResult } from './core';

export const TEACHER_FIELDS: FieldDef[] = [
  { key: 'id', label: '교사ID', required: false, synonyms: ['ID', '교사코드'], note: '비우면 새 교사로 등록 (양식 다운로드 시 자동 기입)' },
  { key: 'name', label: '이름', required: true, synonyms: ['성명', '교사명', '교사'] },
  { key: 'email', label: '이메일', required: false, synonyms: ['메일', 'email', '구글계정', '계정'], note: '로그인에 쓰는 Google 계정. 없으면 교사 화면을 쓸 수 없음' },
  { key: 'subject', label: '담당교과', required: false, synonyms: ['교과', '과목'] },
  { key: 'homeroomGrade', label: '담임학년', required: false, synonyms: ['담임 학년'] },
  { key: 'homeroomClass', label: '담임반', required: false, synonyms: ['담임 반'] },
  {
    key: 'defaultRole',
    label: '감독구분',
    required: false,
    synonyms: ['기본역할', '역할', '감독 구분'],
    note: '일반: 교실·복도 감독 모두 가능 / 복도전담: 복도에만 배정 (비우면 일반). 정·부감독은 자동 배정이 정합니다.',
    options: ['일반', '복도전담'],
  },
  {
    key: 'active',
    label: '사용여부',
    required: false,
    synonyms: ['사용', '재직', '감독배정'],
    note: 'Y: 감독 배정 대상 / N: 배정 제외 (관리자·전출·휴직 등, 교사 화면 로그인도 안 됨. 지난 기록은 유지). 비우면 Y',
    options: ['Y', 'N'],
  },
];

export interface ExistingTeacher {
  id: string;
  name: string;
  email: string | null;
}

export interface TeacherImport {
  /** null이면 새로 등록 */
  id: string | null;
  name: string;
  email: string | null;
  subject: string | null;
  homeroom: Homeroom | null;
  defaultRole: DefaultRole;
  active: boolean;
}

// 예전 양식 값(복도대기, 제외)도 받는다
const ROLE_OPTIONS: Record<string, DefaultRole> = {
  일반: 'NORMAL',
  복도전담: 'HALLWAY',
  복도대기: 'HALLWAY',
  복도: 'HALLWAY',
  감독제외: 'EXCLUDED',
  제외: 'EXCLUDED',
};
const YES_NO: Record<string, 'Y' | 'N'> = { Y: 'Y', 예: 'Y', 사용: 'Y', O: 'Y', N: 'N', 아니오: 'N', 미사용: 'N', X: 'N' };

export function parseTeachers(dataRows: Cell[][], mapping: ColumnMapping, existing: ExistingTeacher[]): ImportResult<TeacherImport> {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const byEmail = new Map(existing.filter((t) => t.email).map((t) => [t.email!, t]));

  const rows = readRows(dataRows, mapping, TEACHER_FIELDS, (r) => {
    const givenId = r.text('id');
    const name = r.text('name', true);
    const email = r.email('email');
    const subject = r.text('subject');
    const hg = r.int('homeroomGrade', { min: 1, max: 6 });
    const hc = r.int('homeroomClass', { min: 1, max: 30 });
    const defaultRole = r.choice('defaultRole', ROLE_OPTIONS, { fallback: 'NORMAL' });
    const active = r.choice('active', YES_NO, { fallback: 'Y' });

    if ((hg === null) !== (hc === null) && !r.errors.length) {
      r.errors.push('담임학년과 담임반은 함께 입력하거나 함께 비워야 합니다.');
    }

    let id: string | null = null;
    if (givenId) {
      if (!byId.has(givenId)) r.errors.push(`교사ID "${givenId}"은(는) 등록되어 있지 않습니다. 새 교사는 교사ID를 비워 주세요.`);
      else id = givenId;
    } else if (email && byEmail.has(email)) {
      id = byEmail.get(email)!.id;
    } else if (name) {
      const same = existing.filter((t) => t.name === name && (!t.email || !email));
      if (same.length > 1) r.errors.push(`동명이인 "${name}"이(가) 있습니다. 교사ID나 이메일로 구분해 주세요.`);
      else if (same.length === 1) id = same[0]!.id;
    }

    if (email && id) {
      const owner = byEmail.get(email);
      if (owner && owner.id !== id) r.errors.push(`이메일 ${email}은(는) 다른 교사(${owner.name})가 사용 중입니다.`);
    }

    if (!name || !defaultRole || !active) return null;
    // 예전 양식의 "감독제외"는 사용여부 N으로 바꿔 저장한다
    const excluded = defaultRole === 'EXCLUDED';
    return {
      id,
      name,
      email,
      subject,
      homeroom: hg !== null && hc !== null ? { grade: hg, classNo: hc } : null,
      defaultRole: excluded ? 'NORMAL' : defaultRole,
      active: active === 'Y' && !excluded,
    };
  });

  flagDuplicates(rows, (v) => v.id, (_, first) => `${first}행과 같은 교사를 다시 수정합니다.`);
  flagDuplicates(rows, (v) => v.email, (key, first) => `이메일 ${key}이(가) ${first}행과 중복됩니다.`);
  flagDuplicates(rows, (v) => (v.id === null && !v.email ? v.name : null), (key, first) => `새 교사 "${key}"이(가) ${first}행과 중복됩니다. 이메일로 구분해 주세요.`);
  flagDuplicates(
    rows,
    (v) => (v.homeroom && v.active ? `${v.homeroom.grade}-${v.homeroom.classNo}` : null),
    (key, first) => `${key}반 담임이 ${first}행과 중복됩니다.`,
  );

  return finish(rows);
}
