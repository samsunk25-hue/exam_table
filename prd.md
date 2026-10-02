# 스마트 시험 감독 매니저 (Smart Invigilation Manager)
**버전:** 1.2 (요구사항 확정판 - Firebase 기반, 알고리즘/스키마 구체화)
**작성일:** 2026-09-30
**목적:** 복잡한 제약조건을 최적화 알고리즘으로 해결하는 학교 맞춤형 클라우드 시험 감독 배정 앱.

> v1.1 원본: [docs/prd_v1.1.md](docs/prd_v1.1.md)

### v1.2 변경 요약
| # | 항목 | 결정 |
|---|---|---|
| 1 | 시험실-시험 연결 | `Exam_Groups`에 `roomId` 추가. 배정 단위 = **슬롯 × 시험실 × 역할(좌석)** |
| 2 | 기초시간표 반영 | 세션별 **선택 옵션**(`useBaseTimetable`). 켜면 날짜→요일 변환 후 "시험실 반의 원래 수업 교사"에 가점. 끄면 기초시간표 업로드도 선택 사항 |
| 3 | 연속 배정 점수 중복 | "+20 비연속"과 "-30 직전 교시 감독"을 **"-30 연속 배정"** 하나로 통합 |
| 4 | 누적 부담 구간 | 하위 20% **+30**, 상위 10% **-40** |
| 5 | Greedy 한계 | 최소 후보 슬롯 우선 처리 + 누적 점수 실시간 갱신 + 개선(재배치/교환) 단계 |
| 6 | Constraints 반영 | `HARD` 규칙은 배정 불가, `SOFT` 규칙은 감점 |
| 7 | 세션 상태 | 7단계 상태 코드로 확장 |
| 8 | 불가시간 승인 | `Teacher_Availability.status` 추가 |
| 9 | 누적 업무점수 | 세션별 계산, 최종 확정 시 `Load_Ledger`에 적립 (교사 문서 값은 파생값) |
| 10 | 범위 정리 | MVP: 가중치 고정 + 결과 미리보기, 셀 클릭형 수동 편집. 드래그앤드롭은 V2, 가중치 슬라이더는 V3 |
| 11 | 이력 관리 | 최종 확정·잠금·Audit Log를 MVP에 포함 |
| 12 | 플랫폼 | Firebase (Auth, Firestore, Cloud Functions, Hosting) + Vite/React |

---

## 1. 성공 기준 (Success Criteria)
* **하드 조건 위반 배정:** 0건 (결함률 0%)
* **자동 배정 성공률:** 95% 이상 (잔여 슬롯 5% 미만)
* **수동 수정 필요 슬롯:** 전체 배정의 10% 이하
* **업무 형평성:** 교사별 누적 감독 점수(가중치 반영) 편차 최소화 — 결과 화면에 표준편차·최대-최소 차 표시
* **시간 단축:** 개인별 시간표 및 전체 시간표 생성 시간 1분 이내
* **이력 추적:** 확정 이후의 모든 변경사항(100%) Audit Log 기록 — Cloud Functions 트리거로 강제

---

## 2. 단계별 개발 전략 (Phasing Strategy)

### MVP (1차 개발 목표)
- [x] 권한 분리 (관리자 / 일반 교사) — Google 로그인 + Custom Claims, 관리자 추가/제거
- [x] 기본 데이터 세팅 (표준 엑셀 양식 다운로드, 교사/기초시간표/시험일정/시험실 엑셀 일괄 업로드 및 검증 미리보기, 통합 양식, 학급 수로 교실 자동 생성)
- [x] 교사별 불가시간 입력 (교사 제출 + 관리자 승인/반려/대리 입력, 시간대별 인력 현황)
- [x] 하드 조건 + 소프트 조건 기반 **자동 감독 배정 엔진** (가중치 고정, 결과 미리보기 후 적용) + 다중 시나리오 비교(9.2)
- [x] 미배정/충돌 원인 분석 및 **셀 클릭형** 수동 수정 UI + N각 연쇄 교환 추천(9.3)
- [x] 워크플로 7단계, **최종 확정·변경 잠금·Audit Log** (변경 이력 화면·엑셀)
- [x] 전체 시간표 및 개인별 미니 시간표 출력 (웹 뷰어, 엑셀, 휴대폰 캘린더 .ics, 인쇄/PDF — 컴퓨터·휴대폰 자동 조정)

### V2 (고도화 및 자율 참여)
- [x] 시수 형평성 대시보드 (가중치 기반 업무 점수화) — 프로젝트 "업무 점수" 탭, 학년도 누적·편차·엑셀
- [x] 별도시험장(시간 연장, 일부 학생) 상세 로직 — 특별실 별도 운영 시간, 겹치는 교시까지 감독 차지
- [x] 교사 간 감독 교환(Swap) 워크플로우 및 승인 시스템 — 방법 찾기(맞바꾸기·연쇄·넘기기) → 동료 수락 → 관리자 승인
- [x] 출제 교사 '복도 대기' 등 예외 역할 세분화 — 프로젝트 설정: 상관없음 / 복도 대기 우선 / 교실 감독 제외(하드), 감독구분(일반·복도전담·사용 안 함)
- [x] 시간표 편집기 드래그 앤 드롭 — 이름을 끌어 빈칸이면 옮기기, 다른 교사 칸이면 맞바꾸기 (초록/빨강 미리 표시, 하드 조건 검사)
- [x] 알림 — 이메일 대신 앱 안 알림(🔔)으로 구현 (공개·확정·불가시간·교환·가입·감독 변경)

### V3 (예측 및 외부 연동)
- [x] 배정 시뮬레이션 (조건별 가중치 슬라이더 조절 및 결과 예측) — 자동 배정 탭: 브라우저에서 즉시 재계산·기본값 비교, 그 설정으로 정식 실행
- [ ] 메신저(카카오톡 알림톡) 연동 — 학교 명의 카카오 비즈니스 채널·발송 계약 필요 (앱 안 알림으로 대체 중)
- [x] 과거 시험 데이터 기반 누적 분석 및 피로도 예측 — 업무 점수 탭: 학년도 시험별 추이(학기 간 교사는 이메일로 연결), 피로도 높음/보통/낮음과 이유

---

## 3. UI/UX 화면 구조도

### [관리자 모드]
* **대시보드:** 현재 진행 중인 시험 프로젝트 현황 및 누적 통계
* **기본 설정:** 교사 관리 / 기초시간표 / 시험 일정 / 시험실 세팅 (항목별 엑셀 양식 다운로드, 업로드 → 검증 미리보기 → 저장). 세션 설정에서 **기초시간표 반영 여부** 선택
* **조건 수집:** 교사별 근무 불가 시간 현황 (승인/반려/대리 입력)
* **자동배정 & 결과 미리보기:** 성공률, 형평성 지표, 미배정 사유 확인 후 "적용" (MVP 가중치 고정 / V3 슬라이더)
* **시간표 편집기:** 날짜·교시 × 시험실 그리드. 셀 클릭 시 후보 교사를 점수순으로 표시, 하드 조건 위반 시 경고 (V2 드래그 앤 드롭)
* **승인 센터 (V2):** 교사 Swap 요청 관리
* **출력/알림 센터:** 전체/개인 시간표 PDF 인쇄 (알림 발송은 V2)

### [일반 교사 모드]
* **내 감독 시간표:** 본인에게 배정된 감독 일정 및 배정 사유 확인 (교사 공개 단계 이후)
* **불가 시간 관리:** 내 근무 불가 시간(출장, 연수 등) 제출 및 승인 상태 확인
* **교환(Swap) 센터 (V2):** 동료에게 교환 요청 및 수신된 요청 수락/거절
* **공지/알림함 (V2):** 배정 확정 및 변경 알림

---

## 4. 업무 워크플로우 (세션 상태)

| 단계 | 상태 코드 | 내용 | 교사 열람 | 배정 수정 |
|---|---|---|---|---|
| 1 | `DRAFT` | 표준 엑셀 양식으로 기초 데이터 업로드 및 세팅, 불가시간 수집 | ✕ | - |
| 2 | `AUTO_ASSIGNED` | 자동 배정 실행 및 결과 적용 | ✕ | 자유 |
| 3 | `REVIEW` | 관리자 검토, 미배정 슬롯 수동 할당 | ✕ | 자유 |
| 4 | `PUBLISHED` | 1차 초안 교사 공개 | ○ | 자유 (로그 기록) |
| 5 | `SWAP` | 교사 자율 교환 요청 및 관리자 승인 (V2, MVP에서는 건너뜀 가능) | ○ | 승인 경유 |
| 6 | `CONFIRMED` | 최종 확정 — 세션 업무점수를 `Load_Ledger`에 적립 | ○ | 사유 입력 필수 |
| 7 | `LOCKED` | 변경 잠금 — 이후 수정은 관리자 잠금 해제 + 사유 입력, `Audit_Logs` 강제 기록 | ○ | 잠금 해제 필요 |

* 상태 전환은 Cloud Functions(Callable)로만 수행하며, 전환 자체도 Audit Log에 기록한다.
* Audit Log는 모든 단계에서 기록하되, 성공 기준(100%)은 `CONFIRMED` 이후 변경을 대상으로 한다.

---

## 5. 배정 알고리즘 명세

후보자 점수화(Scoring) + 최소 후보 우선 처리 + 개선 단계로 동작한다. 엔진은 Firebase에 의존하지 않는 순수 TypeScript 모듈(`packages/engine`)로 구현하며, 입력 JSON → 결과 JSON의 결정적(deterministic) 함수다.

### 5.1. 배정 단위 (좌석, Seat)
각 `Exam_Group`(슬롯 × 시험실)에 대해 시험실의 필요 인원만큼 좌석을 만든다.

| 조건 | 좌석 역할 | 가중치 |
|---|---|---|
| 일반 시험, 정감독 좌석 | 정감독 `CHIEF` | 1.0 |
| 부감독 좌석 | 부감독 `ASSISTANT` | 0.8 |
| 슬롯 유형이 자습 | 자습감독 `STUDY` | 0.6 |
| 그룹 `roomType`이 연장 | 연장감독 `EXTENDED` | 1.5 |
| 시험실 공간유형이 복도 | 복도대기 `HALLWAY` | 0.5 |

### 5.2. [1단계] 하드 조건 (배정 절대 불가)
1. 같은 날짜·교시에 이미 배정됨 (동시간대 중복)
2. `Teacher_Availability`에 해당 날짜·교시 불가 등록 (상태 `PENDING`, `APPROVED` 모두 차단 / `REJECTED`는 무시)
3. 같은 날 직전 교시에 **연장감독(EXTENDED)** 수행
4. `Constraints`의 `HARD` 규칙
   - `HOMEROOM_EXCLUDE`: 본인 담임 반 시험실 감독 불가
   - `SLOT_EXCLUDE`: 지정 슬롯 감독 불가
   - `SUBJECT_EXCLUDE`: 지정 과목 시험 감독 불가 (예: 출제 교사)
5. 사용여부 N(비활성) 교사 — 관리자·전출·휴직 등 (예전 데이터의 `defaultRole = EXCLUDED`도 동일)
6. 감독구분: `복도전담`(`HALLWAY`) 교사는 복도 좌석에만 배정. `일반`(`NORMAL`) 교사는 교실·복도 모두 가능 (복도 좌석은 복도전담 교사에게 +20 가점)

### 5.3. [2단계] 소프트 조건 점수 (기본 가중치, MVP 고정)
| 항목 | 점수 | 비고 |
|---|---|---|
| 기초시간표 일치 | +50 | `useBaseTimetable = true`일 때만. 시험 날짜의 요일·교시에 **해당 시험실 반**을 원래 가르치는 교사 |
| 누적 업무부담 하위 20% | +30 | 누적 부담 = 과거 적립(`Load_Ledger`) + 이번 세션 배정 가중치 합 (실시간 갱신) |
| 누적 업무부담 상위 10% | -40 | 동일 |
| 해당 학년 담임 아님 | +10 | |
| 연속 배정 | -30 | 같은 날 직전 또는 직후 교시에 이미 배정됨 |
| `SOFT` 제약 규칙 해당 | -50 | 규칙별 `penalty` 값으로 조정 가능 |

동점 처리: 누적 부담이 낮은 교사 → 교사 ID 순 (결정적 결과 보장).

### 5.4. [3단계] 매칭 (최소 후보 우선)
1. 모든 좌석의 하드 조건 통과 후보를 계산한다.
2. 미배정 좌석 중 **현재 후보 수가 가장 적은 좌석**을 선택한다 (동률 시 날짜·교시·시험실 순).
3. 후보 점수를 내림차순 정렬해 최고점 교사를 배정하고, 배정 근거 텍스트를 저장한다. 예: `"+50(기초일치), +10(비담임)"`
4. 교사의 이번 세션 부담 점수에 역할 가중치를 즉시 더하고 1로 돌아간다.

### 5.5. [4단계] 개선 단계
1. **연쇄 재배치(Ejection chain, 1단계):** 미배정 좌석 S에 대해, 같은 시간대에 다른 좌석 A를 맡은 교사 T를 S로 옮기고 A를 다른 가용 교사 U에게 넘길 수 있으면 수행해 미배정을 줄인다.
2. **형평성 재배치:** 부담 최고 교사의 좌석을 부담이 더 낮은 가용 교사에게 넘겼을 때 두 교사의 부담 차가 줄어들면 수행한다. 변화가 없거나 반복 한도에 도달하면 종료한다.
3. 모든 단계는 하드 조건 검증 함수(`validateAssignments`)를 통과해야만 반영된다.

### 5.6. [5단계] 미배정 처리 및 설명
* 후보가 0명인 좌석은 빈칸으로 두고, 탈락 사유를 사유별로 집계한다.
  * 예: `"2-5반 수학 정감독 미배정 (가용 인력 0명 - 불가시간 3명, 동시간 타 감독 40명, 연장 직후 2명)"`
* 결과 지표: 좌석 수, 배정 수, 성공률, 교사별 부담 점수, 표준편차, 최대-최소 차.

### 5.7. 검증 함수
`validateAssignments(input, assignments)`는 5.2의 하드 조건 위반 목록을 반환한다. 자동 배정 결과, 수동 수정, 교환 승인 모두 저장 직전에 이 함수를 통과해야 한다.

---

## 6. 데이터 모델 (Firestore)

### 6.1. 컬렉션 구조
```
users/{uid}                         사용자/권한
admins/{email}                      관리자 목록 (앱에서 추가/제거, 기본 관리자는 bootstrap)
teachers/{teacherId}                교사 기본 (학교 공통)
rooms/{roomId}                      물리적 공간 (학교 공통)
loadLedger/{ledgerId}               누적 업무점수 적립 이력
auditLogs/{logId}                   학교 공통 데이터(교사, 시험실) 변경 이력
sessions/{sessionId}                시험 프로젝트
  ├─ baseTimetable/{teacherId}      기초 시간표 (교사당 문서 1개, entries 배열)
  ├─ slots/{slotId}                 시험 1건 + 시험실 배치(rooms 배열)
  ├─ availability/{availId}         교사 불가시간
  ├─ constraints/{constraintId}     배정 예외 규칙
  ├─ runs/{runId}                   자동배정 실행 결과(미리보기)
  ├─ assignments/{assignId}         배정 결과
  ├─ busy/{date_period_teacherId}   동시간대 중복 방지 인덱스
  ├─ swapRequests/{requestId}       (V2) 교환 요청
  └─ auditLogs/{logId}              행동 추적
notifications/{notiId}              (V2) 알림
```

### 6.2. 문서 필드
* **`users`**: `teacherId`, `role`(`ADMIN`/`TEACHER`), `email`, `active` — role은 Custom Claims에도 동기화
* **`teachers`**: `name`, `email`(소문자, 로그인 계정 연결용), `subject`, `homeroom`(`{grade, classNo}` | null), `defaultRole`(감독구분: `NORMAL` 일반 / `HALLWAY` 복도전담, `EXCLUDED`는 예전 데이터 호환용), `active`(사용여부: false면 배정·로그인 제외), `cumulativeLoad`(파생값, Ledger 합계)
* **`rooms`**: `name`, `chiefCount`(필요 정감독 수), `assistantCount`(필요 부감독 수), `spaceType`(`CLASSROOM`/`SEPARATE`/`HALLWAY`), `grade`, `classNo` — 학년·반은 기본 배치 자동 생성에 사용
* **`loadLedger`**: `teacherId`, `sessionId`, `load`, `confirmedAt`
* **`sessions`**: `schoolName`, `year`, `semester`, `examName`, `status`(4장 상태 코드), `settings`(`useBaseTimetable`, `weights`), `stats`
* **`baseTimetable`**: 문서 ID = teacherId, `entries[]`: `{weekday(1=월~5=금), period, grade, classNo, subject}`
* **`slots`**: 문서 ID = `{date}_{period}_{grade}`, `date`(YYYY-MM-DD), `period`, `startTime`, `endTime`, `grade`, `subject`, `type`(`EXAM`/`STUDY`), `rooms[]`: `{roomId, classNo(null이면 혼합/별도), headcount, roomType(NORMAL/EXTENDED/SPECIAL)}` — 엔진의 그룹 ID = `{slotId}__{roomId}`
  * 시험실 배치를 별도 컬렉션 대신 시험 문서에 둔 이유: 시험 36건 × 시험실 28개 기준 문서 약 1,000개 → 36개로 줄고, 변경 이력이 시험 단위로 남는다.
* **`availability`**: `teacherId`, `date`, `period`, `available`(false), `reason`, `source`(`TEACHER`/`ADMIN`), `status`(`PENDING`/`APPROVED`/`REJECTED`)
* **`constraints`**: `teacherId`, `type`(`HOMEROOM_EXCLUDE`/`SLOT_EXCLUDE`/`SUBJECT_EXCLUDE`), `target`(slotId 또는 과목명), `priority`(`HARD`/`SOFT`), `penalty`
* **`runs`**: `createdAt`, `createdBy`, `settings`, `assignments[]`, `unassigned[]`, `metrics` — "적용" 시 `assignments`로 복사
* **`assignments`**: 문서 ID = `{slotId}__{roomId}_{role}_{seatNo}` (좌석당 1명), `slotId`, `groupId`, `roomId`, `role`, `weight`, `teacherId`, `score`, `reason`, `source`(`AUTO`/`MANUAL`), `status`(`CONFIRMED`/`SWAP_PENDING`)
* **`busy`**: 문서 ID = `{date}_{period}_{teacherId}`, `assignId` — 배정 쓰기 트랜잭션에서 함께 생성해 동시간 중복을 DB 수준에서 차단
* **`swapRequests` (V2)**: `requesterId`, `targetId`, `myAssignId`, `theirAssignId`, `reason`, `status`(`REQUESTED`/`ACCEPTED`/`APPROVED`/`REJECTED`)
* **`auditLogs`**: `userId`, `action`(`CREATE`/`UPDATE`/`DELETE`/`SWAP`/`STATUS`), `targetType`, `targetId`, `before`, `after`, `reason`, `createdAt` — Cloud Functions `onDocumentWritten` 트리거가 기록, 클라이언트 쓰기 금지
* **`notifications` (V2)**: `teacherId`, `sessionId`, `type`, `message`, `status`(`UNREAD`/`READ`), `sentAt`

### 6.3. 로그인과 역할 판정
* 로그인 직후 `syncProfile` 함수가 이메일로 역할을 판정해 Custom Claims(`role`, `teacherId`)를 설정한다.
  * `ADMIN_EMAILS` 환경 변수(functions/.env, 기본 관리자) 또는 `admins` 컬렉션에 있으면 `ADMIN`
  * 관리자는 [관리자 관리] 화면에서 다른 관리자를 추가/제거한다 (`addAdmin`/`removeAdmin` 함수). 본인과 기본 관리자는 제거할 수 없다.
  * `teachers.email`과 일치하는 활성 교사가 있으면 `TEACHER`
  * 둘 다 아니면 역할 없음 → "접근 권한 없음" 화면

### 6.4. 보안 규칙 원칙
* 관리자: 전체 읽기/쓰기 (단, `auditLogs`, `loadLedger`, `busy`, 세션 `status`는 Functions 전용)
* 교사: 본인 `availability` 생성/조회, 세션이 `PUBLISHED` 이상일 때 `assignments` 조회, 본인 `teachers` 문서 조회
* 배정 쓰기는 Callable Function을 통해서만 수행해 검증 함수를 강제한다.
* 관리자 쓰기는 `updatedBy == 본인 uid`를 규칙으로 강제하고, Audit Log 트리거가 이 값을 행위자로 기록한다. 삭제는 행위자를 알 수 없어 `lastEditor`(마지막 수정자)로 남긴다.

---

## 7. UI/UX 디자인 가이드라인 (Design System)

**핵심 콘셉트:** 시각적 피로도를 낮추는 고대비(High-contrast) 기반의 직관적 클린(Clean) 디자인

### 7.1. 색상 팔레트
* **배경색:** 아주 밝은 웜그레이(#F8F9FA)
* **메인 컬러:** 스카이 블루(#4A90E2), 보조 민트 그린(#2ECC71)
* **경고/충돌:** 파스텔 레드(#FF6B6B) — 중복 배정·오류 시 텍스트/블록 테두리
* **텍스트:** 다크 그레이(#333333)

### 7.2. 타이포그래피
* **서체:** Pretendard 단일 폰트 (대체: 맑은 고딕)
* **본문:** 16px~18px
* **시간표 셀:** 교사 이름·과목명 Bold
* **제목:** 22px 이상

### 7.3. 레이아웃 및 여백
* **카드형 디자인:** 불가 시간 리스트, 개인별 시간표는 둥근 흰색 카드
* **터치 영역:** 버튼 높이 최소 48px
* **선택적 정보 표시:** 셀에는 교시·반·이름만, 상세는 클릭 시 팝업

---

## 8. 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트엔드 | Vite + React (TypeScript) 단일 페이지 앱, React Router, Tailwind CSS — 서버 렌더링이 필요 없어 Firebase Hosting 정적 배포 |
| 인증 | Firebase Auth (Google 로그인) + Custom Claims |
| DB | Cloud Firestore + Security Rules |
| 서버 로직 | Cloud Functions for Firebase (2nd gen) — 배정 실행, 상태 전환, Audit Log 트리거 |
| 배정 엔진 | `packages/engine` 순수 TypeScript, Vitest 테스트 |
| 엑셀 | SheetJS |
| PDF | 인쇄용 CSS (MVP) |
| 호스팅 | Vercel (GitHub main 푸시 시 자동 배포, https://exam-table-lemon.vercel.app) |
| 요금제 | Firebase Blaze (Cloud Functions 사용에 필요) |

---

## 9. AI 연동 고도화 기능 (AI Integration)
앱의 사용성과 문제 해결력을 극대화하기 위해 다음 3가지 AI 알고리즘을 단계적으로 연동합니다.

### 9.1. 자연어 제약 조건 자동 변환 (NLP)
* **기능 요약:** 교사가 복잡한 날짜/시간 드롭다운 메뉴를 조작할 필요 없이 텍스트(예: "내일 오전 출장입니다")를 입력하면, LLM API가 이를 분석하여 `Teacher_Availability` 테이블의 하드 조건 데이터로 자동 파싱 및 저장.
* **사용 기술:** 대형 언어 모델(LLM) API 개체명 인식(NER) 및 JSON 포맷팅.

### 9.2. 다중 시나리오(멀티버스) 창조 엔진
* **기능 요약:** 알고리즘이 100% 조건 충족에 실패하여 미배정 슬롯이 발생할 경우, 각기 다른 가중치(최적화 목표)를 적용한 3가지 대체 시나리오를 자동 생성하여 관리자에게 제안.
    * A안: 교사 누적 시수 형평성 극대화
    * B안: 연속 배정 완전 배제
    * C안: 출제 교사 복도 대기 우선
* **사용 기술:** 제약 충족 문제(CSP, Constraint Satisfaction Problem) 최적화 알고리즘.

### 9.3. N각 연쇄 교환 (N-way Swap) 추천
* **기능 요약:** 교사 간 1:1 교환(Swap)이 스케줄 충돌로 불가능할 때, 전체 교사의 빈 시간 및 누적 점수 DB를 탐색하여 "A ➔ C ➔ D ➔ B" 형태의 다중 교환 경로를 제안.
* **사용 기술:** 그래프 탐색 알고리즘(Graph Traversal).

### 9.4. 구현 현황 (2026-10-02)
| 기능 | 상태 | 구현 방식 |
|---|---|---|
| 9.1 자연어 불가시간 입력 | 완료 | `functions/src/ai.ts` `aiAvailability` — 문장("11/3 오전 출장")을 시험 시간표의 날짜·교시 칸과 사유로 바꿔 표에 미리 선택, 교사가 확인 후 기존 제출 버튼으로 저장(승인 대기). 오전·오후·하루 종일·"내일" 같은 상대 날짜 처리, 일정에 없는 시간은 버림. 관리자 대리 입력에서는 교사 이름까지 읽어 교사도 고름. 키는 시험을 만든 관리자 것 |
| 9.2 다중 시나리오 | 완료 | `packages/engine/src/scenarios.ts` — 가중치 프리셋 3종(A 형평성 / B 연속 배정 배제 / C 출제 교사 복도 우선)으로 엔진을 다시 실행, 자동 배정 화면에서 지표 비교 후 적용. 모든 안은 하드 조건 충족 |
| 9.3 N각 연쇄 교환 | 완료 | `packages/engine/src/swap.ts` — 짧은 경로부터(1:1 → 3각 → 4각) 깊이 제한 탐색, 교환 후 전체 하드 조건 재검증, 참여 교사의 감독 수 유지. 시간표 편집 화면에서 제안·적용 (`applyAssignmentChanges` 서버 재검증) |
