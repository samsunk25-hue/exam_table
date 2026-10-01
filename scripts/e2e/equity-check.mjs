// 업무 점수 화면: 교환 점검 프로젝트(E2E_SWAP)로 표·요약·엑셀 버튼 확인 (swap-check 이후 실행)
import { go, openApp } from './session.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const A = await openApp();
await go(A.page, '/admin/sessions/E2E_SWAP/equity');
await A.page.getByText('이번 시험 평균').waitFor();
const text = await A.page.locator('main').innerText();
check('요약 카드', text.includes('감독 교사') && text.includes('학년도 누적 편차'));
check('교사별 표 (김국어·이수학 1회씩)', (await A.page.locator('tr', { hasText: '김국어' }).innerText()).includes('1회') && (await A.page.locator('tr', { hasText: '이수학' }).innerText()).includes('1회'));
check('엑셀로 받기 버튼', await A.page.getByRole('button', { name: '엑셀로 받기' }).isEnabled());
await A.page.screenshot({ path: 'scripts/e2e/out/equity.png', fullPage: true });
check('콘솔 오류 없음', A.errors.length === 0, A.errors.join(' / '));
await A.browser.close();
process.exit(failures ? 1 : 0);
