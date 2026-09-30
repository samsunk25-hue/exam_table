import { describe, expect, it } from 'vitest';
import { actionOf, buildAuditLog } from '../../src/auditLog';
import { claimsFor, normalizeEmail, parseEmails, resolveRole } from '../../src/roles';

describe('역할 판정', () => {
  it('관리자 이메일 목록을 소문자로 정리한다', () => {
    expect(parseEmails(' Admin@School.kr , second@school.kr,, ')).toEqual(['admin@school.kr', 'second@school.kr']);
  });

  it('이메일 형식을 검사하고 소문자로 바꾼다', () => {
    expect(normalizeEmail('  Kim@School.KR ')).toBe('kim@school.kr');
    expect(normalizeEmail('kim')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it('관리자 > 교사 > 없음 순으로 판정한다', () => {
    expect(resolveRole(true, 'T001')).toBe('ADMIN');
    expect(resolveRole(false, 'T001')).toBe('TEACHER');
    expect(resolveRole(false, null)).toBe('NONE');
  });

  it('역할이 없으면 Claims를 비운다', () => {
    expect(claimsFor('NONE', null)).toEqual({});
    expect(claimsFor('TEACHER', 'T001')).toEqual({ role: 'TEACHER', teacherId: 'T001' });
    expect(claimsFor('ADMIN', null)).toEqual({ role: 'ADMIN' });
  });
});

describe('감사 로그', () => {
  it('변경 종류를 구분한다', () => {
    expect(actionOf(undefined, { a: 1 })).toBe('CREATE');
    expect(actionOf({ a: 1 }, undefined)).toBe('DELETE');
    expect(actionOf({ status: 'DRAFT' }, { status: 'REVIEW' })).toBe('STATUS');
    expect(actionOf({ name: 'a' }, { name: 'b' })).toBe('UPDATE');
  });

  it('행위자와 사유를 기록하고, 삭제는 마지막 수정자를 따로 남긴다', () => {
    expect(
      buildAuditLog('sessions', 'S1', { status: 'LOCKED', updatedBy: 'u1' }, { status: 'CONFIRMED', updatedBy: 'u2', lastChangeReason: '오타 수정' }),
    ).toMatchObject({ action: 'STATUS', userId: 'u2', reason: '오타 수정', lastEditor: null });
    expect(buildAuditLog('rooms', 'R1', { updatedBy: 'u1' }, undefined)).toMatchObject({
      action: 'DELETE',
      userId: null,
      lastEditor: 'u1',
    });
  });
});
