// AI 기능 (Claude API): 학교 문서에서 시험 일정·교사 명단 읽기, 배정 이유 설명, 공정성 점검 리포트.
// API 키는 관리자마다 자기 것을 넣는다 → aiKeys/{uid} (보안 규칙상 함수만 읽고 쓴다. 코드·저장소·배포 파일에 없음).
// 교사용 설명은 그 시험 프로젝트를 만든 관리자의 키를 쓴다. 에뮬레이터에서 키가 없으면 가짜 응답으로 흐름만 점검한다.
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { DEFAULT_ROLE_WEIGHTS, buildEngineInput, buildSeats, seatCandidates, type Seat } from '@sim/engine';
import { SEAT_ROLE_LABEL, type SessionStatus } from '@sim/shared';
import { db, requireAdmin, serverTimestamp } from './common';
import { loadData } from './runs';

const MODEL = 'claude-opus-5-5';
const AI_OPTIONS = { timeoutSeconds: 300, memory: '512MiB' as const };
const API = 'https://api.anthropic.com/v1';
const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

/** 관리자 본인의 키 (없으면 null) */
async function keyOf(uid: string | undefined | null): Promise<string | null> {
  if (!uid) return null;
  const snap = await db().doc(`aiKeys/${uid}`).get();
  return (snap.get('key') as string | undefined) ?? null;
}

/** 관리자: 내 AI 키 등록·바꾸기. 키를 실제로 확인한 뒤 비공개 저장소에 둔다 (화면에는 끝 4자리만). */
export const setMyAiKey = onCall({ timeoutSeconds: 30 }, async (req) => {
  const uid = requireAdmin(req);
  const { key } = (req.data ?? {}) as { key?: unknown };
  const k = typeof key === 'string' ? key.trim() : '';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new HttpsError('invalid-argument', 'Claude API 키 형식이 아닙니다 (sk-ant-로 시작).');
  // 에뮬레이터 점검용 가짜 키(sk-ant-test-…)는 확인을 건너뛴다
  if (!(isEmulator() && k.startsWith('sk-ant-test-'))) {
    const res = await fetch(`${API}/models?limit=1`, { headers: headers(k) });
    if (res.status === 401 || res.status === 403) throw new HttpsError('permission-denied', '키가 맞지 않습니다. Anthropic 콘솔에서 키를 다시 확인해 주세요.');
    if (!res.ok) throw new HttpsError('unavailable', `키를 확인하지 못했습니다 (${res.status}). 잠시 뒤 다시 시도해 주세요.`);
  }
  await db().doc(`aiKeys/${uid}`).set({ key: k, email: (req.auth?.token.email as string | undefined) ?? null, updatedAt: serverTimestamp() });
  await db().doc(`users/${uid}`).set({ ai: { last4: k.slice(-4), updatedAt: serverTimestamp() } }, { merge: true });
  return { last4: k.slice(-4) };
});

/** 관리자: 내 AI 키 삭제 */
export const clearMyAiKey = onCall(async (req) => {
  const uid = requireAdmin(req);
  await db().doc(`aiKeys/${uid}`).delete();
  await db().doc(`users/${uid}`).set({ ai: null }, { merge: true });
  return { cleared: true };
});

type Block = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** 키가 없을 때: 에뮬레이터면 가짜 응답(null), 아니면 안내 오류 */
function needKey(key: string | null, forTeacher = false): string | null {
  // 에뮬레이터 점검용 가짜 키는 실제로 부르지 않는다
  if (key && isEmulator() && key.startsWith('sk-ant-test-')) return null;
  if (key) return key;
  if (isEmulator()) return null;
  throw new HttpsError(
    'failed-precondition',
    forTeacher ? '관리자가 AI 키를 등록하지 않아 설명을 볼 수 없습니다. 관리자에게 문의하세요.' : '내 AI 키가 없습니다. 관리자 관리 > 내 AI 키에서 Claude API 키를 등록하세요.',
  );
}

/** Claude 호출. tool을 주면 그 도구 입력(JSON)을, 아니면 글을 돌려준다. */
async function claude(key: string, o: { system: string; content: Block[]; tool?: Tool; maxTokens?: number }): Promise<unknown> {
  const res = await fetch(`${API}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: o.maxTokens ?? 4000,
      system: o.system,
      messages: [{ role: 'user', content: o.content }],
      ...(o.tool ? { tools: [o.tool], tool_choice: { type: 'tool', name: o.tool.name } } : {}),
    }),
  });
  if (res.status === 401 || res.status === 403) throw new HttpsError('permission-denied', 'AI 키가 맞지 않거나 만료되었습니다. 관리자 관리 > 내 AI 키를 확인하세요.');
  if (res.status === 402 || res.status === 429) throw new HttpsError('resource-exhausted', 'AI 사용 한도나 잔액이 부족합니다. Anthropic 콘솔의 결제(Billing)를 확인하세요.');
  if (!res.ok) {
    const body = await res.text();
    throw new HttpsError('unavailable', `AI 응답 오류 (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content: { type: string; text?: string; input?: unknown }[] };
  if (o.tool) {
    const used = json.content.find((c) => c.type === 'tool_use');
    if (!used) throw new HttpsError('internal', 'AI가 결과를 정해진 형식으로 주지 않았습니다. 다시 시도해 주세요.');
    return used.input;
  }
  return json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
}

// ───────────────────────── 3. 학교 문서에서 자료 읽기 ─────────────────────────

const EXTRACT_TOOL: Tool = {
  name: 'record_school_data',
  description: '문서에서 읽은 시험 일정과 교사 명단을 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      slots: {
        type: 'array',
        description: '시험 1건 = 날짜·교시·학년 하나. 같은 교시에 학년이 여러 개면 학년마다 한 줄.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            period: { type: 'integer' },
            startTime: { type: ['string', 'null'], description: 'HH:MM (없으면 null)' },
            endTime: { type: ['string', 'null'], description: 'HH:MM (없으면 null)' },
            grade: { type: 'integer' },
            subject: { type: 'string' },
            type: { type: 'string', enum: ['시험', '자습'] },
          },
          required: ['date', 'period', 'grade', 'subject', 'type'],
        },
      },
      teachers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            subject: { type: ['string', 'null'] },
            homeroomGrade: { type: ['integer', 'null'] },
            homeroomClass: { type: ['integer', 'null'] },
            email: { type: ['string', 'null'] },
          },
          required: ['name'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: '읽기 어려웠던 부분, 확인이 필요한 점 (한국어, 짧게)' },
    },
    required: ['slots', 'teachers', 'notes'],
  },
};

interface ExtractResult {
  slots: { date: string; period: number; startTime?: string | null; endTime?: string | null; grade: number; subject: string; type: '시험' | '자습' }[];
  teachers: { name: string; subject?: string | null; homeroomGrade?: number | null; homeroomClass?: number | null; email?: string | null }[];
  notes: string[];
}

const MEDIA = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv']);

/** 교육계획서·시험 시간표·업무 분장표 등(PDF·사진·글)에서 시험 일정과 교사 명단을 읽는다 */
export const aiExtract = onCall(AI_OPTIONS, async (req) => {
  const key = needKey(await keyOf(requireAdmin(req)));
  const { kind, files, text, year } = (req.data ?? {}) as {
    kind?: unknown;
    files?: { name?: unknown; mediaType?: unknown; data?: unknown }[];
    text?: unknown;
    year?: unknown;
  };
  const want = kind === 'schedule' || kind === 'teachers' ? kind : 'both';
  const list = Array.isArray(files) ? files.slice(0, 4) : [];
  const content: Block[] = [];
  for (const f of list) {
    const mediaType = String(f.mediaType);
    const data = String(f.data ?? '');
    if (!MEDIA.has(mediaType) || !data) throw new HttpsError('invalid-argument', `읽을 수 없는 파일 형식입니다: ${String(f.name)}`);
    if (mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data } });
    else if (mediaType.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    else content.push({ type: 'text', text: Buffer.from(data, 'base64').toString('utf8').slice(0, 100_000) });
  }
  if (typeof text === 'string' && text.trim()) content.push({ type: 'text', text: text.slice(0, 100_000) });
  if (!content.length) throw new HttpsError('invalid-argument', '읽을 파일이나 글을 넣어 주세요.');

  const y = typeof year === 'number' ? year : new Date().getFullYear();
  const task =
    want === 'schedule' ? '시험 일정만 읽으세요 (teachers는 빈 배열).' : want === 'teachers' ? '교사 명단만 읽으세요 (slots는 빈 배열).' : '시험 일정과 교사 명단을 모두 읽으세요.';
  content.push({
    type: 'text',
    text: `위 학교 문서에서 ${task}
- 학년도는 ${y}학년도입니다. 날짜에 연도가 없으면 3~12월은 ${y}년, 1~2월은 ${y + 1}년으로 쓰세요.
- 시험 일정: 날짜·교시·학년마다 한 줄. "자습"·"자율학습"은 type을 자습으로. 시간이 적혀 있으면 HH:MM으로.
- 교사 명단: 교사(담임·교과 교사)만. 행정직원은 빼세요. 담임은 "1-3" 같은 표기를 학년·반 숫자로.
- 문서에 없는 값은 지어내지 말고 null로 두고, 애매한 점은 notes에 적으세요.`,
  });

  const out = !key
    ? fakeExtract(y)
    : ((await claude(key, {
        system: '당신은 한국 중·고등학교 교무 문서를 정확히 표로 옮기는 도우미입니다. 반드시 record_school_data 도구로만 답합니다.',
        content,
        tool: EXTRACT_TOOL,
        maxTokens: 8000,
      })) as ExtractResult);
  return {
    slots: want === 'teachers' ? [] : (out.slots ?? []),
    teachers: want === 'schedule' ? [] : (out.teachers ?? []),
    notes: out.notes ?? [],
  };
});

function fakeExtract(y: number): ExtractResult {
  return {
    slots: [
      { date: `${y}-10-12`, period: 1, startTime: '09:00', endTime: '09:45', grade: 1, subject: '국어', type: '시험' },
      { date: `${y}-10-12`, period: 1, startTime: '09:00', endTime: '09:45', grade: 2, subject: '수학', type: '시험' },
      { date: `${y}-10-12`, period: 2, startTime: '10:00', endTime: '10:45', grade: 1, subject: '자습', type: '자습' },
    ],
    teachers: [
      { name: '문서교사가', subject: '국어', homeroomGrade: 1, homeroomClass: 5, email: null },
      { name: '문서교사나', subject: '수학', homeroomGrade: null, homeroomClass: null, email: 'doc.b@test.kr' },
    ],
    notes: ['(에뮬레이터 가짜 응답) 실제 AI 키가 없어서 예시 자료를 돌려줍니다.'],
  };
}

// ───────────────────────── 2. 배정 설명과 공정성 리포트 ─────────────────────────

const round = (n: number) => Math.round(n * 10) / 10;
const seatLabel = (s: Seat) => `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))} ${s.period}교시 ${s.roomName} ${SEAT_ROLE_LABEL[s.role]}`;

async function loadSession(sessionId: string, req: CallableRequest, admin: boolean) {
  const snap = await db().doc(`sessions/${sessionId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', '시험 프로젝트를 찾을 수 없습니다.');
  if (!admin) {
    const t = req.auth!.token;
    if (snap.get('schoolName') !== t.school || snap.get('year') !== t.year || snap.get('semester') !== t.semester) {
      throw new HttpsError('permission-denied', '다른 학교·학기 시험입니다.');
    }
  }
  const { data, current } = await loadData(sessionId, true);
  const input = buildEngineInput(data);
  const seats = new Map(buildSeats(input, DEFAULT_ROLE_WEIGHTS).map((s) => [s.id, s]));
  return { snap, status: snap.get('status') as SessionStatus, data, current, input, seats };
}

/** 교사별 이번 시험 점수·학년도 누적·연속·하루 최다 */
function loadStats(L: Awaited<ReturnType<typeof loadSession>>) {
  const confirmed = L.status === 'CONFIRMED' || L.status === 'LOCKED';
  return L.data.teachers
    .filter((t) => t.active)
    .map((t) => {
      const mine = L.current.filter((a) => a.teacherId === t.id);
      const load = round(mine.reduce((s, a) => s + a.weight, 0));
      const prior = round(confirmed ? (t.cumulativeLoad ?? 0) - load : (t.cumulativeLoad ?? 0));
      const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
      const consecutive = [...times].filter((k) => times.has(`${k.split('|')[0]}|${Number(k.split('|')[1]) + 1}`)).length;
      const perDay = new Map<string, number>();
      for (const a of mine) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
      return { id: t.id, name: t.name, count: mine.length, load, total: round(prior + load), consecutive, maxDay: Math.max(0, ...perDay.values()) };
    });
}

/** 교사: "왜 이렇게 배정됐나요?" — 본인 감독과 점수 이유를 쉬운 말로 (다른 교사 정보는 이름 없이 통계만) */
export const aiExplainDuties = onCall(AI_OPTIONS, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const admin = req.auth.token.role === 'ADMIN';
  const { sessionId, teacherId: asked } = (req.data ?? {}) as { sessionId?: unknown; teacherId?: unknown };
  const teacherId = admin && typeof asked === 'string' ? asked : (req.auth.token.teacherId as string | undefined);
  if (typeof sessionId !== 'string' || !teacherId) throw new HttpsError('invalid-argument', '시험과 교사를 확인해 주세요.');
  const L = await loadSession(sessionId, req, admin);
  if (!admin && !['PUBLISHED', 'SWAP', 'CONFIRMED', 'LOCKED'].includes(L.status)) {
    throw new HttpsError('failed-precondition', '시간표가 공개된 뒤에 설명을 볼 수 있습니다.');
  }
  const key = needKey((await keyOf(L.snap.get('createdBy') as string | undefined)) ?? (await keyOf(L.snap.get('updatedBy') as string | undefined)), !admin);
  const me = L.data.teachers.find((t) => t.id === teacherId);
  if (!me) throw new HttpsError('not-found', '교사 명단에 없습니다.');
  const stats = loadStats(L);
  const mine = stats.find((s) => s.id === teacherId);
  const loads = stats.map((s) => s.total).sort((a, b) => a - b);
  const mean = round(loads.reduce((s, x) => s + x, 0) / (loads.length || 1));
  const rank = loads.filter((x) => x > (mine?.total ?? 0)).length + 1;
  const duties = L.current
    .filter((a) => a.teacherId === teacherId)
    .map((a) => `- ${L.seats.get(a.id) ? seatLabel(L.seats.get(a.id)!) : a.id}: 점수 이유 ${a.reason || '(수동 배정)'}`);
  const unavailable = L.data.availability.filter((a) => a.teacherId === teacherId && a.status !== 'REJECTED').map((a) => `${a.date} ${a.period}교시`);

  const facts = `교사: ${me.name} (${me.subject ?? '교과 미상'}${me.homeroom ? `, ${me.homeroom.grade}-${me.homeroom.classNo} 담임` : ''})
이번 시험 감독 ${mine?.count ?? 0}회, 이번 업무 점수 ${mine?.load ?? 0}, 학년도 누적 ${mine?.total ?? 0}
학교 전체 학년도 누적: 평균 ${mean}, 최저 ${loads[0] ?? 0}, 최고 ${loads[loads.length - 1] ?? 0} (교사 ${loads.length}명 중 높은 순 ${rank}위)
연속 감독 ${mine?.consecutive ?? 0}쌍, 하루 최다 ${mine?.maxDay ?? 0}회
신청한 불가시간: ${unavailable.join(', ') || '없음'}
감독 목록과 배정 점수 이유:
${duties.join('\n') || '- 없음'}
점수 이유 읽는 법: 기초일치=그 시간 원래 수업하던 반, 부담하위=누적이 적어 우선, 부담상위=누적이 많아 감점, 비담임=그 학년 담임이 아님, 연속=이어지는 교시 감점, 복도전담·출제교사 복도=역할 맞춤.
배정 원칙: 불가시간·동시간 중복·연장 감독 직후는 절대 배정하지 않고, 나머지는 위 점수가 높은 교사를 고르며, 누적이 적은 교사를 먼저 배정해 형평을 맞춘다.`;

  const text = !key
    ? `(에뮬레이터 가짜 응답) ${me.name} 선생님은 이번 시험에서 감독 ${mine?.count ?? 0}회를 맡았습니다. 학년도 누적 ${mine?.total ?? 0}점으로 학교 평균 ${mean}점과 비교됩니다.`
    : ((await claude(key, {
        system:
          '당신은 학교 시험 감독 배정 결과를 교사에게 친절하게 설명하는 도우미입니다. 주어진 사실만 쓰고 지어내지 마세요. 다른 교사의 이름이나 개인 사정은 언급하지 마세요. 한국어 존댓말로, 5~8문장, 필요하면 "- "로 시작하는 짧은 목록을 쓰고 마크다운 제목·굵은 글씨는 쓰지 마세요.',
        content: [{ type: 'text', text: `${facts}\n\n이 교사가 "왜 이렇게 배정됐나요?"라고 물었습니다. 감독 횟수와 시간이 정해진 이유, 다른 교사와 비교한 형평성, 바꾸고 싶을 때 할 수 있는 일(교환 요청)을 설명해 주세요.` }],
        maxTokens: 1200,
      })) as string);
  return { text };
});

/** 관리자: 공정성 점검 리포트 + 바로 적용할 수 있는 감독 옮기기 제안 */
export const aiFairnessReport = onCall(AI_OPTIONS, async (req) => {
  const key = needKey(await keyOf(requireAdmin(req)));
  const { sessionId } = (req.data ?? {}) as { sessionId?: unknown };
  if (typeof sessionId !== 'string') throw new HttpsError('invalid-argument', '시험 프로젝트를 확인해 주세요.');
  const L = await loadSession(sessionId, req, true);
  const stats = loadStats(L);
  if (!L.current.length) throw new HttpsError('failed-precondition', '배정이 아직 없습니다. 자동 배정을 먼저 적용하세요.');
  const name = new Map(stats.map((s) => [s.id, s.name]));
  const total = new Map(stats.map((s) => [s.id, s.total]));
  const mean = stats.reduce((s, x) => s + x.total, 0) / (stats.length || 1);
  const sd = Math.sqrt(stats.reduce((s, x) => s + (x.total - mean) ** 2, 0) / (stats.length || 1));

  // 제안: 누적이 많은 교사의 감독을, 조건을 지키며 누적이 적은 교사에게 넘기기 (최대 5건, 같은 교사 두 번 받지 않게)
  const plain = L.current.filter((a) => L.seats.has(a.id)).map((a) => ({ seatId: a.id, teacherId: a.teacherId }));
  const heavy = [...stats].sort((a, b) => b.total - a.total).slice(0, 4);
  const moves: { seatId: string; from: string; to: string; label: string; effect: string }[] = [];
  const used = new Set<string>();
  for (const h of heavy) {
    // 지금 일정·시험실에 없는 옛 배정 기록은 건너뛴다
    for (const a of L.current.filter((x) => x.teacherId === h.id && L.seats.has(x.id))) {
      if (moves.length >= 5) break;
      const best = seatCandidates(L.input, plain, a.id)
        .filter((c) => !c.blockedBy && c.teacherId !== h.id && !used.has(c.teacherId) && (total.get(c.teacherId) ?? 0) + a.weight < h.total - 0.5)
        .sort((x, y) => (total.get(x.teacherId) ?? 0) - (total.get(y.teacherId) ?? 0))[0];
      if (!best) continue;
      used.add(best.teacherId);
      moves.push({
        seatId: a.id,
        from: h.id,
        to: best.teacherId,
        label: `${L.seats.get(a.id) ? seatLabel(L.seats.get(a.id)!) : a.id}: ${h.name} → ${best.name}`,
        effect: `${h.name} ${h.total}→${round(h.total - a.weight)}, ${best.name} ${total.get(best.teacherId) ?? 0}→${round((total.get(best.teacherId) ?? 0) + a.weight)}`,
      });
      break; // 한 교사에서 하나씩
    }
  }

  const table = [...stats]
    .sort((a, b) => b.total - a.total)
    .map((s) => `${s.name}: 감독 ${s.count}회, 이번 ${s.load}점, 학년도 누적 ${s.total}점, 연속 ${s.consecutive}쌍, 하루 최다 ${s.maxDay}회`)
    .join('\n');
  const facts = `교사 ${stats.length}명, 학년도 누적 평균 ${round(mean)}점, 표준편차 ${round(sd)}점
${table}
조건을 지키는 옮기기 제안:
${moves.map((m, i) => `${i + 1}. ${m.label} (${m.effect})`).join('\n') || '없음'}`;

  const text = !key
    ? `(에뮬레이터 가짜 응답) 학년도 누적 평균 ${round(mean)}점, 편차 ${round(sd)}점입니다. 옮기기 제안 ${moves.length}건을 확인하세요.`
    : ((await claude(key, {
        system:
          '당신은 학교 시험 감독 배정의 공정성을 점검하는 교무 도우미입니다. 주어진 수치만 근거로, 관리자(교감·교무부장)가 바로 이해하도록 한국어로 씁니다. 마크다운 제목·굵은 글씨 없이 짧은 문단과 "- " 목록만 쓰고 10~15줄 안으로 씁니다.',
        content: [
          {
            type: 'text',
            text: `${facts}\n\n공정성 점검 리포트를 써 주세요: 1) 전체 평가(편차가 큰지), 2) 부담이 몰린 교사와 적은 교사, 3) 연속·하루 3회 이상 같은 피로 위험, 4) 위 옮기기 제안을 적용하면 좋아지는 점. 제안에 없는 교체를 지어내지 마세요.`,
          },
        ],
        maxTokens: 1500,
      })) as string);
  return { text, moves, mean: round(mean), sd: round(sd), names: Object.fromEntries(name) };
});

// ───────────────────────── 4. 글로 쓴 고려사항 → 배정 규칙 ─────────────────────────

type Effect = 'FORBID' | 'AVOID' | 'PREFER';
type Strength = 'WEAK' | 'NORMAL' | 'STRONG';
interface RawRule {
  teacherIds: string[];
  effect: Effect;
  strength?: Strength;
  when?: { dates?: string[]; periods?: number[]; grades?: number[]; roles?: string[]; subjects?: string[]; roomIds?: string[]; ownHomeroom?: boolean };
  label: string;
}

const ROLE_KO: Record<string, string> = { CHIEF: '정감독', ASSISTANT: '부감독', STUDY: '자습감독', EXTENDED: '연장감독', HALLWAY: '복도' };
const POINTS: Record<Strength, number> = { WEAK: 30, NORMAL: 60, STRONG: 120 };

const RULES_TOOL: Tool = {
  name: 'record_rules',
  description: '관리자가 쓴 고려사항을 감독 배정 규칙으로 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            teacherIds: { type: 'array', items: { type: 'string' }, description: '교사 id 목록. 모든 교사에게 해당하면 ["*"]' },
            effect: { type: 'string', enum: ['FORBID', 'AVOID', 'PREFER'], description: 'FORBID=절대 배정 안 함, AVOID=가능하면 피함, PREFER=가능하면 맡김' },
            strength: { type: 'string', enum: ['WEAK', 'NORMAL', 'STRONG'], description: 'AVOID·PREFER의 세기 (기본 NORMAL)' },
            when: {
              type: 'object',
              description: '해당하는 날짜·교시·자리. 적지 않은 항목은 "모두". 여러 값은 그중 하나면 해당.',
              properties: {
                dates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD, 시험 일정에 있는 날짜만' },
                periods: { type: 'array', items: { type: 'integer' } },
                grades: { type: 'array', items: { type: 'integer' } },
                roles: { type: 'array', items: { type: 'string', enum: ['CHIEF', 'ASSISTANT', 'STUDY', 'EXTENDED', 'HALLWAY'] } },
                subjects: { type: 'array', items: { type: 'string' }, description: '시험 과목명 (일정에 있는 이름 그대로)' },
                roomIds: { type: 'array', items: { type: 'string' } },
                ownHomeroom: { type: 'boolean', description: '담임이 자기 반 교실 감독일 때만' },
              },
            },
            label: { type: 'string', description: '사람이 읽는 한 줄 설명 (한국어, 예: "김국어: 11/3 1교시 감독 금지")' },
          },
          required: ['teacherIds', 'effect', 'label'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: '규칙으로 바꾸지 못한 부분, 모호해서 확인이 필요한 점 (한국어, 짧게)' },
    },
    required: ['rules', 'notes'],
  },
};

/** 관리자: 글로 쓴 고려사항을 규칙으로 바꾼 미리보기 (저장은 화면에서 확인 후) */
export const aiRules = onCall(AI_OPTIONS, async (req) => {
  const key = needKey(await keyOf(requireAdmin(req)));
  const { sessionId, text } = (req.data ?? {}) as { sessionId?: unknown; text?: unknown };
  if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim()) throw new HttpsError('invalid-argument', '고려사항을 적어 주세요.');
  if (text.length > 4000) throw new HttpsError('invalid-argument', '4000자 이내로 적어 주세요.');
  const L = await loadSession(sessionId, req, true);
  const teachers = L.data.teachers.filter((t) => t.active);
  const dates = [...new Set(L.data.slots.map((s) => s.date))].sort();
  const subjects = [...new Set(L.data.slots.map((s) => s.subject))];
  const roomIds = new Set(L.data.rooms.map((r) => r.id));

  const raw: { rules: RawRule[]; notes: string[] } = !key
    ? fakeRules(text, teachers, dates)
    : ((await claude(key, {
        system:
          '당신은 학교 시험 감독 배정 규칙을 만드는 도우미입니다. 관리자가 쓴 고려사항을 record_rules 도구로만 답합니다. 주어진 교사 id·날짜·과목·시험실 id만 쓰고 지어내지 마세요. 한 문장에 여러 교사·조건이 있으면 규칙을 나누세요. "빼 달라·안 된다·불가"는 FORBID, "가급적 빼 달라·적게"는 AVOID, "맡겨 달라·우선"은 PREFER. 하루 횟수 제한처럼 날짜·교시·자리로 나타낼 수 없는 것은 규칙을 만들지 말고 notes에 적으세요.',
        content: [
          {
            type: 'text',
            text: `교사 (id: 이름, 과목, 담임):
${teachers.map((t) => `${t.id}: ${t.name}, ${t.subject ?? '-'}, ${t.homeroom ? `${t.homeroom.grade}-${t.homeroom.classNo}` : '-'}`).join('\n')}
시험 일정 (날짜 교시 학년 과목):
${L.data.slots.map((s) => `${s.date} ${s.period}교시 ${s.grade}학년 ${s.subject}`).join('\n')}
시험실 (id: 이름): ${L.data.rooms.map((r) => `${r.id}: ${r.name}`).join(', ')}
감독 자리 종류: CHIEF=정감독, ASSISTANT=부감독, STUDY=자습감독, EXTENDED=연장감독, HALLWAY=복도

관리자 고려사항:
${text}`,
          },
        ],
        maxTokens: 3000,
        tool: RULES_TOOL,
      })) as { rules: RawRule[]; notes: string[] });

  // 받은 규칙을 검사하고 교사별 문서로 펼친다
  const ids = new Set(teachers.map((t) => t.id));
  const notes = [...(raw.notes ?? [])];
  const rules: Record<string, unknown>[] = [];
  for (const r of raw.rules ?? []) {
    const who = (r.teacherIds ?? []).includes('*') ? ['*'] : (r.teacherIds ?? []).filter((id) => ids.has(id));
    if (!who.length || !['FORBID', 'AVOID', 'PREFER'].includes(r.effect)) {
      notes.push(`확인 필요: "${r.label}" — 교사를 찾지 못해 뺐습니다.`);
      continue;
    }
    const w = r.when ?? {};
    const when = {
      ...(w.dates?.length ? { dates: w.dates.filter((d) => dates.includes(d)) } : {}),
      ...(w.periods?.length ? { periods: w.periods.filter((p) => Number.isInteger(p) && p >= 1 && p <= 10) } : {}),
      ...(w.grades?.length ? { grades: w.grades.filter((g) => Number.isInteger(g) && g >= 1 && g <= 6) } : {}),
      ...(w.roles?.length ? { roles: w.roles.filter((x) => x in ROLE_KO) } : {}),
      ...(w.subjects?.length ? { subjects: w.subjects.filter((x) => subjects.includes(x)) } : {}),
      ...(w.roomIds?.length ? { roomIds: w.roomIds.filter((x) => roomIds.has(x)) } : {}),
      ...(w.ownHomeroom ? { ownHomeroom: true } : {}),
    };
    // 조건 값이 모두 걸러져 빈 목록이 되면 "모든 자리"로 넓어지므로 뺀다
    if (Object.values(when).some((v) => Array.isArray(v) && v.length === 0)) {
      notes.push(`확인 필요: "${r.label}" — 일정에 없는 날짜·과목·시험실이 있어 뺐습니다.`);
      continue;
    }
    const pts = POINTS[r.strength ?? 'NORMAL'] ?? 60;
    for (const t of who) {
      rules.push({
        teacherId: t,
        type: 'RULE',
        when,
        priority: r.effect === 'FORBID' ? 'HARD' : 'SOFT',
        ...(r.effect === 'FORBID' ? {} : { penalty: r.effect === 'AVOID' ? -pts : pts }),
        label: String(r.label ?? '').slice(0, 200),
      });
    }
  }
  return { rules, notes };
});

/** 에뮬레이터 점검용: 문장에서 교사 이름·날짜(M/D)·교시를 찾아 규칙 하나 */
function fakeRules(text: string, teachers: { id: string; name: string }[], dates: string[]): { rules: RawRule[]; notes: string[] } {
  const t = teachers.find((x) => text.includes(x.name));
  if (!t) return { rules: [], notes: ['(가짜 응답) 교사 이름을 찾지 못했습니다.'] };
  const md = text.match(/(\d{1,2})\s*[/월.]\s*(\d{1,2})/);
  const date = md ? dates.find((d) => Number(d.slice(5, 7)) === Number(md[1]) && Number(d.slice(8, 10)) === Number(md[2])) : undefined;
  const p = text.match(/(\d)\s*교시/);
  const effect: Effect = /가급적|가능하면|되도록|적게/.test(text) ? 'AVOID' : /빼|안\s?되|불가|금지|제외/.test(text) ? 'FORBID' : 'PREFER';
  const when = { ...(date ? { dates: [date] } : {}), ...(p ? { periods: [Number(p[1])] } : {}) };
  const what = { FORBID: '감독 금지', AVOID: '가급적 피하기', PREFER: '우선 배정' }[effect];
  const md2 = date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ` : '';
  return {
    rules: [{ teacherIds: [t.id], effect, when, label: `${t.name}: ${md2}${p ? `${p[1]}교시 ` : ''}${what}` }],
    notes: ['(에뮬레이터 가짜 응답) 실제 AI 대신 간단히 읽었습니다.'],
  };
}
