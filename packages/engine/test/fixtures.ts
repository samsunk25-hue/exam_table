import type {
  Availability,
  BaseTimetableEntry,
  EngineInput,
  Group,
  Room,
  Slot,
  Teacher,
} from '../src';

export function teacher(id: string, extra: Partial<Teacher> = {}): Teacher {
  return {
    id,
    name: `교사${id}`,
    homeroom: null,
    defaultRole: 'NORMAL',
    active: true,
    priorLoad: 0,
    ...extra,
  };
}

export function emptyInput(extra: Partial<EngineInput> = {}): EngineInput {
  return {
    teachers: [],
    rooms: [],
    slots: [],
    groups: [],
    availability: [],
    constraints: [],
    baseTimetable: [],
    settings: { useBaseTimetable: false },
    ...extra,
  };
}

/** 결정적 난수 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SchoolOptions {
  seed?: number;
  teacherCount?: number;
  hallwayTeachers?: number;
  grades?: number;
  classesPerGrade?: number;
  days?: string[];
  periodsPerDay?: number;
  unavailableRate?: number;
  useBaseTimetable?: boolean;
}

/**
 * 가상 학교: 학년별 교실 + 학년별 복도 + 별도시험장(연장) 1실.
 * 매 교시 모든 학년이 시험을 본다.
 */
export function fakeSchool(opts: SchoolOptions = {}): EngineInput {
  const {
    seed = 42,
    teacherCount = 60,
    hallwayTeachers = 5,
    grades = 3,
    classesPerGrade = 8,
    days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
    periodsPerDay = 3,
    unavailableRate = 0.1,
    useBaseTimetable = true,
  } = opts;
  const rand = rng(seed);
  const subjects = ['국어', '수학', '영어', '과학', '사회', '역사', '도덕', '기술가정'];

  const teachers: Teacher[] = [];
  for (let i = 1; i <= teacherCount; i++) {
    const id = `T${String(i).padStart(3, '0')}`;
    const homeroomIdx = i - 1;
    const homeroom =
      homeroomIdx < grades * classesPerGrade
        ? { grade: Math.floor(homeroomIdx / classesPerGrade) + 1, classNo: (homeroomIdx % classesPerGrade) + 1 }
        : null;
    teachers.push(
      teacher(id, {
        subject: subjects[i % subjects.length],
        homeroom,
        defaultRole: i > teacherCount - hallwayTeachers ? 'HALLWAY' : i === 1 ? 'EXCLUDED' : 'NORMAL',
        priorLoad: Math.round(rand() * 4 * 10) / 10,
      }),
    );
  }

  const rooms: Room[] = [];
  for (let g = 1; g <= grades; g++) {
    for (let c = 1; c <= classesPerGrade; c++) {
      rooms.push({ id: `R${g}${c}`, name: `${g}-${c}`, chiefCount: 1, assistantCount: 0, spaceType: 'CLASSROOM' });
    }
    rooms.push({ id: `H${g}`, name: `${g}학년 복도`, chiefCount: 1, assistantCount: 0, spaceType: 'HALLWAY' });
  }
  rooms.push({ id: 'SEP', name: '별도시험장', chiefCount: 1, assistantCount: 0, spaceType: 'SEPARATE' });

  const slots: Slot[] = [];
  const groups: Group[] = [];
  for (const date of days) {
    for (let p = 1; p <= periodsPerDay; p++) {
      for (let g = 1; g <= grades; g++) {
        const slotId = `S-${date}-${p}-${g}`;
        const subject = subjects[(p + g + days.indexOf(date)) % subjects.length]!;
        slots.push({ id: slotId, date, period: p, grade: g, subject, type: 'EXAM' });
        for (let c = 1; c <= classesPerGrade; c++) {
          groups.push({ id: `${slotId}-R${g}${c}`, slotId, roomId: `R${g}${c}`, grade: g, classNo: c, roomType: 'NORMAL' });
        }
        groups.push({ id: `${slotId}-H${g}`, slotId, roomId: `H${g}`, grade: g, classNo: null, roomType: 'NORMAL' });
        if (g === 1) {
          groups.push({ id: `${slotId}-SEP`, slotId, roomId: 'SEP', grade: g, classNo: null, roomType: 'EXTENDED' });
        }
      }
    }
  }

  const availability: Availability[] = [];
  for (const t of teachers) {
    for (const date of days) {
      for (let p = 1; p <= periodsPerDay; p++) {
        if (rand() < unavailableRate) {
          availability.push({ teacherId: t.id, date, period: p, status: rand() < 0.8 ? 'APPROVED' : 'PENDING', reason: '출장' });
        }
      }
    }
  }

  const baseTimetable: BaseTimetableEntry[] = [];
  for (const t of teachers) {
    for (let k = 0; k < 18; k++) {
      baseTimetable.push({
        teacherId: t.id,
        weekday: 1 + Math.floor(rand() * 5),
        period: 1 + Math.floor(rand() * periodsPerDay),
        grade: 1 + Math.floor(rand() * grades),
        classNo: 1 + Math.floor(rand() * classesPerGrade),
      });
    }
  }

  return {
    teachers,
    rooms,
    slots,
    groups,
    availability,
    constraints: [
      { teacherId: 'T002', type: 'HOMEROOM_EXCLUDE', priority: 'HARD' },
      { teacherId: 'T003', type: 'SUBJECT_EXCLUDE', target: '수학', priority: 'HARD' },
      { teacherId: 'T004', type: 'SUBJECT_EXCLUDE', target: '영어', priority: 'SOFT' },
    ],
    baseTimetable,
    settings: { useBaseTimetable },
  };
}
