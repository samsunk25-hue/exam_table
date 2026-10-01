import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_FIELDS,
  ROOM_FIELDS,
  SLOT_FIELDS,
  TEACHER_FIELDS,
  TIMETABLE_FIELDS,
  autoMap,
  autoPlacements,
  checkSchedule,
  groupTimetable,
  missingRequired,
  nextId,
  parseDate,
  parsePlacements,
  parseRooms,
  parseSlots,
  parseTeachers,
  parseTime,
  parseTimetable,
  type Cell,
  type RoomDoc,
  type SlotDoc,
  type WithId,
} from '../src';

/** 헤더 + 데이터 행을 받아 자동 매핑 후 파서를 호출 */
function sheet(rows: Cell[][]) {
  const [header, ...data] = rows;
  return { header: header!, data };
}

describe('셀 값 해석', () => {
  it('여러 날짜 형식을 YYYY-MM-DD로', () => {
    expect(parseDate('2026-10-12')).toBe('2026-10-12');
    expect(parseDate('2026.10.2')).toBe('2026-10-02');
    expect(parseDate('2026년 10월 12일')).toBe('2026-10-12');
    expect(parseDate(46307)).toBe('2026-10-12'); // 엑셀 일련번호
    expect(parseDate(new Date(2026, 9, 12))).toBe('2026-10-12');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('다음주')).toBeNull();
  });

  it('여러 시각 형식을 HH:MM으로', () => {
    expect(parseTime('9:00')).toBe('09:00');
    expect(parseTime('09:40:00')).toBe('09:40');
    expect(parseTime(0.375)).toBe('09:00'); // 엑셀 시각
    expect(parseTime('25:00')).toBeNull();
  });

  it('헤더 이름이 조금 달라도 자동 매핑한다', () => {
    const mapping = autoMap(['성명', ' 이메일 ', '담당 교과', '비고'], TEACHER_FIELDS);
    expect(mapping).toMatchObject({ name: 0, email: 1, subject: 2, id: null });
    expect(missingRequired(autoMap(['이메일'], TEACHER_FIELDS), TEACHER_FIELDS)).toEqual(['이름']);
  });

  it('ID 자동 생성', () => {
    expect(nextId('T', ['T001', 'T009', 'X100'], 2)).toEqual(['T010', 'T011']);
  });
});

describe('교사 업로드', () => {
  const existing = [
    { id: 'T001', name: '김국어', email: 'kim@school.kr' },
    { id: 'T002', name: '이수학', email: null },
    { id: 'T003', name: '박영어', email: null },
    { id: 'T004', name: '박영어', email: null },
  ];

  it('교사ID → 이메일 → 이름 순으로 기존 교사를 찾고, 없으면 새로 등록한다', () => {
    const { header, data } = sheet([
      ['교사ID', '이름', '이메일', '담임학년', '담임반', '기본역할', '사용여부'],
      ['T001', '김국어', 'KIM@school.kr', 1, 1, '', ''],
      ['', '이수학', 'lee@school.kr', '', '', '복도대기', 'N'],
      ['', '최신규', '', '', '', '', ''],
    ]);
    const r = parseTeachers(data, autoMap(header, TEACHER_FIELDS), existing);
    expect(r.errorCount).toBe(0);
    expect(r.rows.map((x) => x.value)).toEqual([
      { id: 'T001', name: '김국어', email: 'kim@school.kr', subject: null, homeroom: { grade: 1, classNo: 1 }, defaultRole: 'NORMAL', active: true },
      { id: 'T002', name: '이수학', email: 'lee@school.kr', subject: null, homeroom: null, defaultRole: 'HALLWAY', active: false },
      { id: null, name: '최신규', email: null, subject: null, homeroom: null, defaultRole: 'NORMAL', active: true },
    ]);
  });

  it('동명이인, 없는 ID, 이메일 형식, 담임 반쪽 입력, 중복을 오류로 표시한다', () => {
    const { header, data } = sheet([
      ['교사ID', '이름', '이메일', '담임학년', '담임반', '기본역할'],
      ['', '박영어', '', '', '', ''],
      ['T999', '없음', '', '', '', ''],
      ['', '홍길동', 'not-an-email', '', '', ''],
      ['', '임담임', '', 2, '', ''],
      ['', '새교사', 'new@school.kr', '', '', '교장'],
      ['', '새교사2', 'new@school.kr', '', '', ''],
      ['', '다른사람', 'kim@school.kr', '', '', ''],
    ]);
    const r = parseTeachers(data, autoMap(header, TEACHER_FIELDS), existing);
    const errors = r.rows.map((x) => x.errors.join(' | '));
    expect(errors[0]).toContain('동명이인');
    expect(errors[1]).toContain('등록되어 있지 않습니다');
    expect(errors[2]).toContain('이메일 형식');
    expect(errors[3]).toContain('함께 입력');
    expect(errors[4]).toContain('허용되지 않습니다');
    // 5번째 행은 역할 오류로 제외되므로 6번째 행의 이메일은 중복이 아니다
    expect(errors[5]).toBe('');
    // 기존 김국어의 이메일로 새 교사 등록 → 김국어 수정으로 해석되므로 이름이 바뀌는 행이 됨
    expect(r.rows[6]!.value?.id).toBe('T001');
  });

  it('예전 양식의 감독제외는 사용여부 N으로 바꾼다', () => {
    const { header, data } = sheet([
      ['이름', '기본역할', '사용여부'],
      ['교장', '감독제외', 'Y'],
      ['복도', '복도대기', ''],
    ]);
    const r = parseTeachers(data, autoMap(header, TEACHER_FIELDS), []);
    expect(r.rows.map((x) => [x.value?.defaultRole, x.value?.active])).toEqual([
      ['NORMAL', false],
      ['HALLWAY', true],
    ]);
  });

  it('파일에 없는 기존 교사와 담임 반이 겹치면 오류, 그 교사를 함께 고치면 통과', () => {
    const db = [{ id: 'T001', name: '김국어', email: null, homeroom: { grade: 1, classNo: 1 }, active: true }];
    const { header, data } = sheet([
      ['이름', '담임학년', '담임반'],
      ['새담임', 1, 1],
    ]);
    const r = parseTeachers(data, autoMap(header, TEACHER_FIELDS), db);
    expect(r.rows[0]!.errors[0]).toContain('이미 김국어 교사');

    const both = sheet([
      ['교사ID', '이름', '담임학년', '담임반'],
      ['T001', '김국어', '', ''],
      ['', '새담임', 1, 1],
    ]);
    expect(parseTeachers(both.data, autoMap(both.header, TEACHER_FIELDS), db).errorCount).toBe(0);
  });

  it('같은 담임 반이 두 번 나오면 오류', () => {
    const { header, data } = sheet([
      ['이름', '담임학년', '담임반'],
      ['가', 1, 1],
      ['나', 1, 1],
    ]);
    const r = parseTeachers(data, autoMap(header, TEACHER_FIELDS), []);
    expect(r.rows[1]!.errors[0]).toContain('1-1반 담임이 2행과 중복');
  });
});

describe('시험실 업로드', () => {
  it('기본값을 채우고 실명으로 기존 시험실을 찾는다', () => {
    const { header, data } = sheet([
      ['실명', '공간유형', '학년', '반', '정감독수', '부감독수'],
      ['1-1', '', 1, 1, '', ''],
      ['1학년 복도', '복도', 1, '', 1, 0],
      ['별도시험장', '별도시험장', '', '', 1, 1],
    ]);
    const r = parseRooms(data, autoMap(header, ROOM_FIELDS), [{ id: 'R001', name: '1-1' }]);
    expect(r.errorCount).toBe(0);
    expect(r.rows.map((x) => [x.value?.id, x.value?.spaceType, x.value?.chiefCount, x.value?.assistantCount])).toEqual([
      ['R001', 'CLASSROOM', 1, 0],
      [null, 'HALLWAY', 1, 0],
      [null, 'SEPARATE', 1, 1],
    ]);
  });

  it('감독 수 0, 학년 없는 반, 복도의 반 번호, 중복을 오류로', () => {
    const { header, data } = sheet([
      ['실명', '공간유형', '학년', '반', '정감독수', '부감독수'],
      ['A', '교실', 1, 1, 0, 0],
      ['B', '교실', '', 2, 1, 0],
      ['C', '복도', 1, 3, 1, 0],
      ['D', '교실', 1, 1, 1, 0],
      ['D', '교실', 2, 1, 1, 0],
    ]);
    const r = parseRooms(data, autoMap(header, ROOM_FIELDS), []);
    expect(r.rows.map((x) => x.errors.length > 0)).toEqual([true, true, true, false, true]);
  });
});

describe('기초시간표 업로드', () => {
  const teachers = [
    { id: 'T001', name: '김국어', email: 'kim@school.kr', active: true },
    { id: 'T002', name: '박영어', email: 'park1@school.kr', active: true },
    { id: 'T003', name: '박영어', email: 'park2@school.kr', active: true },
    { id: 'T004', name: '퇴직자', email: null, active: false },
  ];

  it('교사 이름·이메일로 연결하고 교사별로 묶는다', () => {
    const { header, data } = sheet([
      ['교사', '요일', '교시', '학년', '반', '과목'],
      ['김국어', '화', 2, 1, 3, '국어'],
      ['김국어', '월요일', 1, 1, 1, '국어'],
      ['park2@school.kr', '수', 1, 2, 1, '영어'],
    ]);
    const r = parseTimetable(data, autoMap(header, TIMETABLE_FIELDS), teachers);
    expect(r.errorCount).toBe(0);
    const grouped = groupTimetable(r.rows.map((x) => x.value!));
    expect(grouped.get('T001')!.map((e) => [e.weekday, e.period])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(grouped.get('T003')).toHaveLength(1);
  });

  it('없는 교사, 동명이인, 비활성 교사, 같은 시간 중복을 오류로', () => {
    const { header, data } = sheet([
      ['교사', '요일', '교시', '학년', '반'],
      ['없는사람', '월', 1, 1, 1],
      ['박영어', '월', 1, 1, 1],
      ['퇴직자', '월', 1, 1, 1],
      ['김국어', '월', 1, 1, 1],
      ['김국어', '월', 1, 1, 2],
      ['김국어', '토', 1, 1, 2],
    ]);
    const r = parseTimetable(data, autoMap(header, TIMETABLE_FIELDS), teachers);
    const errors = r.rows.map((x) => x.errors.join(' | '));
    expect(errors[0]).toContain('명단에 없습니다');
    expect(errors[1]).toContain('동명이인');
    expect(errors[2]).toContain('명단에 없습니다');
    expect(errors[3]).toBe('');
    expect(errors[4]).toContain('중복');
    expect(errors[5]).toContain('토·일요일');
  });
});

describe('시험 일정과 배치', () => {
  const rooms: WithId<RoomDoc>[] = [
    { id: 'R1', name: '1-1', spaceType: 'CLASSROOM', grade: 1, classNo: 1, chiefCount: 1, assistantCount: 0 },
    { id: 'R2', name: '1-2', spaceType: 'CLASSROOM', grade: 1, classNo: 2, chiefCount: 1, assistantCount: 0 },
    { id: 'H1', name: '1학년 복도', spaceType: 'HALLWAY', grade: 1, classNo: null, chiefCount: 1, assistantCount: 0 },
    { id: 'S', name: '별도시험장', spaceType: 'SEPARATE', grade: null, classNo: null, chiefCount: 1, assistantCount: 0 },
    { id: 'R21', name: '2-1', spaceType: 'CLASSROOM', grade: 2, classNo: 1, chiefCount: 1, assistantCount: 0 },
  ];

  it('시험 일정을 읽고 slotId를 만든다', () => {
    const { header, data } = sheet([
      ['날짜', '교시', '시작시간', '종료시간', '학년', '과목', '유형'],
      ['2026-10-12', 1, '09:00', '09:45', 1, '국어', ''],
      ['2026-10-12', 1, '09:00', '09:45', 1, '수학', ''],
      ['2026-10-12', 2, '10:00', '09:50', 2, '영어', '자습'],
    ]);
    const r = parseSlots(data, autoMap(header, SLOT_FIELDS));
    expect(r.rows[0]!.value).toMatchObject({ id: '2026-10-12_1_1', type: 'EXAM', startTime: '09:00' });
    expect(r.rows[1]!.errors[0]).toContain('중복');
    expect(r.rows[2]!.errors[0]).toContain('종료시간');
  });

  it('기본 배치는 같은 학년 교실과 복도만', () => {
    expect(autoPlacements({ grade: 1 }, rooms).map((p) => [p.roomId, p.classNo])).toEqual([
      ['R1', 1],
      ['R2', 2],
      ['H1', null],
    ]);
  });

  it('배치 업로드: 없는 시험·시험실, 같은 시간 시험실 중복을 오류로', () => {
    const slots = [
      { id: '2026-10-12_1_1', date: '2026-10-12', period: 1, grade: 1 },
      { id: '2026-10-12_1_2', date: '2026-10-12', period: 1, grade: 2 },
    ];
    const { header, data } = sheet([
      ['날짜', '교시', '학년', '시험실', '반', '시험실유형'],
      ['2026-10-12', 1, 1, '별도시험장', '', '연장'],
      ['2026-10-12', 1, 2, '별도시험장', '', ''],
      ['2026-10-12', 3, 1, '1-1', 1, ''],
      ['2026-10-12', 1, 1, '없는실', 1, ''],
    ]);
    const r = parsePlacements(data, autoMap(header, PLACEMENT_FIELDS), slots, rooms);
    expect(r.rows[0]!.value?.placement).toEqual({ roomId: 'S', classNo: null, headcount: null, roomType: 'EXTENDED' });
    expect(r.rows[1]!.errors[0]).toContain('같은 시간에 같은 시험실');
    expect(r.rows[2]!.errors[0]).toContain('시험이 없습니다');
    expect(r.rows[3]!.errors[0]).toContain('시험실 관리에 없습니다');
  });

  it('전체 점검: 배치 없음, 시험실 중복을 찾는다', () => {
    const slot = (id: string, grade: number, roomIds: string[]): WithId<SlotDoc> => ({
      id,
      date: '2026-10-12',
      period: 1,
      startTime: null,
      endTime: null,
      grade,
      subject: '국어',
      type: 'EXAM',
      rooms: roomIds.map((roomId) => ({ roomId, classNo: null, headcount: null, roomType: 'NORMAL' })),
    });
    const issues = checkSchedule([slot('a', 1, ['R1', 'S']), slot('b', 2, ['S']), slot('c', 3, [])], rooms);
    expect(issues.map((i) => i.message)).toEqual([
      '2026-10-12 1교시 2학년 국어: 별도시험장이(가) 같은 시간 2026-10-12 1교시 1학년 국어에도 배치되어 있습니다.',
      '2026-10-12 1교시 3학년 국어: 배치된 시험실이 없습니다.',
    ]);
    expect(checkSchedule([], rooms)[0]!.message).toBe('시험 일정이 없습니다.');
  });
});
