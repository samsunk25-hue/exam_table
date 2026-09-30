import { describe, expect, it } from 'vitest';
import {
  BUNDLE_SHEETS,
  analyzeBundle,
  isGridSheet,
  parseClassCell,
  parseTimetableGrid,
  timetableGridRows,
  timetableSheetNames,
  type BundleContext,
  type Cell,
  type SheetRows,
} from '../src';

const HEADER = ['교시', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];

/** 학교 양식 모양의 시트: cells[교시-1][요일-1] */
function grid(name: string, cells: Record<string, string>): SheetRows {
  const rows: Cell[][] = [HEADER];
  for (let p = 1; p <= 12; p++) {
    rows.push([`${p}교시`, ...[1, 2, 3, 4, 5, 6, 7].map((d) => cells[`${d}-${p}`] ?? '')]);
  }
  return { name, rows };
}

const teachers = [
  { id: 'T001', name: '김국어', email: 'kim@s.kr', active: true },
  { id: 'T002', name: '박영어', email: 'p1@s.kr', active: true },
  { id: 'T003', name: '박영어', email: 'p2@s.kr', active: true },
];

describe('학교 기초시간표 양식 (교사별 격자)', () => {
  it('여러 칸 표기를 학년·반·과목으로 해석한다', () => {
    expect(parseClassCell('1-3')).toEqual({ grade: 1, classNo: 3, subject: null });
    expect(parseClassCell('1-3 국어')).toEqual({ grade: 1, classNo: 3, subject: '국어' });
    expect(parseClassCell('국어\n2-10')).toEqual({ grade: 2, classNo: 10, subject: '국어' });
    expect(parseClassCell('국어(3-1)')).toEqual({ grade: 3, classNo: 1, subject: '국어' });
    expect(parseClassCell('1학년 3반')).toEqual({ grade: 1, classNo: 3, subject: null });
    expect(parseClassCell('103 수학')).toEqual({ grade: 1, classNo: 3, subject: '수학' });
    expect(parseClassCell('창체')).toBeNull();
  });

  it('학교 양식(교시 × 월~일요일)을 알아본다', () => {
    expect(isGridSheet(grid('empty0', {}).rows)).toBe(true);
    expect(isGridSheet([['교사', '요일', '교시']])).toBe(false);
  });

  it('시트 이름으로 교사를 찾고 칸마다 수업을 만든다. 빈 시트는 건너뛴다', () => {
    const r = parseTimetableGrid(
      [grid('empty0', {}), grid('김국어', { '1-1': '1-3 국어', '2-2': '1-4' }), grid('박영어(T003)', { '3-1': '2-1 영어' })],
      teachers,
    );
    expect(r.errorCount).toBe(0);
    expect(r.rows.map((x) => [x.label, x.value?.teacherId, x.value?.grade, x.value?.classNo])).toEqual([
      ['김국어 · 월 1교시', 'T001', 1, 3],
      ['김국어 · 화 2교시', 'T001', 1, 4],
      ['박영어(T003) · 수 1교시', 'T003', 2, 1],
    ]);
  });

  it('없는 교사, 동명이인, 해석 불가 칸, 주말 수업을 오류로', () => {
    const r = parseTimetableGrid(
      [grid('홍길동', { '1-1': '1-1' }), grid('박영어', { '1-1': '1-1' }), grid('김국어', { '1-1': '창체', '6-1': '1-1' })],
      teachers,
    );
    const errors = r.rows.map((x) => x.errors.join(' | '));
    expect(errors[0]).toContain('같은 교사가 명단에 없습니다');
    expect(errors[1]).toContain('동명이인');
    expect(errors[2]).toContain('학년-반을 알 수 없습니다');
    expect(errors[3]).toContain('토·일요일');
  });

  it('양식 생성: 학교 양식과 같은 모양, 동명이인은 이름(ID) 시트', () => {
    const rows = timetableGridRows([{ weekday: 2, period: 3, grade: 1, classNo: 4, subject: '국어' }]);
    expect(rows[0]).toEqual(HEADER);
    expect(rows).toHaveLength(13);
    expect(rows[3]![2]).toBe('1-4 국어');
    expect([...timetableSheetNames(teachers).values()]).toEqual(['김국어', '박영어(T002)', '박영어(T003)']);
    // 생성한 양식을 다시 읽으면 같은 수업이 나온다
    const back = parseTimetableGrid([{ name: '김국어', rows }], teachers);
    expect(back.rows[0]!.value).toMatchObject({ teacherId: 'T001', weekday: 2, period: 3, grade: 1, classNo: 4, subject: '국어' });
  });
});

describe('기초 자료 통합 양식', () => {
  const ctx: BundleContext = {
    teachers: [
      { id: 'T001', name: '김국어', email: 'kim@s.kr', subject: '국어', homeroom: null, defaultRole: 'NORMAL', active: true, cumulativeLoad: 0 },
    ],
    rooms: [],
    slots: [],
    useBaseTimetable: true,
    scheduleEditable: true,
  };

  const sheets = (): SheetRows[] => [
    { name: BUNDLE_SHEETS.guide, rows: [['안내']] },
    {
      name: BUNDLE_SHEETS.teachers,
      rows: [
        ['교사ID', '이름*', '이메일'],
        ['T001', '김국어', 'kim@s.kr'],
        ['', '이신규', 'new@s.kr'],
      ],
    },
    {
      name: BUNDLE_SHEETS.rooms,
      rows: [
        ['실명*', '공간유형', '학년', '반'],
        ['1-1', '교실', 1, 1],
      ],
    },
    {
      name: BUNDLE_SHEETS.slots,
      rows: [
        ['날짜*', '교시*', '학년*', '과목*'],
        ['2026-10-12', 1, 1, '국어'],
      ],
    },
    { name: BUNDLE_SHEETS.placements, rows: [['날짜*', '교시*', '학년*', '시험실*', '반']] },
    grid('김국어', { '1-1': '1-1 국어' }),
    grid('이신규', { '2-1': '1-1' }),
  ];

  it('파일 안의 새 교사·시험실을 이어지는 시트에서 바로 참조할 수 있다', () => {
    const r = analyzeBundle(sheets(), ctx);
    expect(r.errorCount).toBe(0);
    expect(r.plan.teachers.map((t) => [t.id, t.isNew])).toEqual([
      ['T001', false],
      ['T002', true],
    ]);
    expect(r.plan.rooms.map((x) => [x.id, x.isNew])).toEqual([['R001', true]]);
    expect(r.plan.slots?.map((s) => s.id)).toEqual(['2026-10-12_1_1']);
    // 배치 시트는 제목 행만 있으므로 변경 없음
    expect(r.plan.placements).toBeNull();
    expect(r.plan.timetable?.map((e) => e.teacherId)).toEqual(['T001', 'T002']);
  });

  it('시트가 없으면 변경 없음, 공개 이후에는 일정·시간표 변경을 막는다', () => {
    const onlyTeachers = sheets().filter((s) => s.name === BUNDLE_SHEETS.teachers);
    const r1 = analyzeBundle(onlyTeachers, ctx);
    expect(r1.sections.filter((s) => s.present).map((s) => s.key)).toEqual(['teachers']);
    expect(r1.plan.slots).toBeNull();

    const r2 = analyzeBundle(sheets(), { ...ctx, scheduleEditable: false });
    expect(r2.errorCount).toBe(2);
    expect(r2.sections.find((s) => s.key === 'slots')!.result!.fileErrors[0]).toContain('교사 공개 이후');
  });

  it('기초시간표 반영이 꺼져 있으면 시간표 시트는 무시하고 알린다', () => {
    const r = analyzeBundle(sheets(), { ...ctx, useBaseTimetable: false });
    expect(r.errorCount).toBe(0);
    expect(r.plan.timetable).toBeNull();
    expect(r.sections.find((s) => s.key === 'timetable')!.notes[0]).toContain('무시');
  });
});
