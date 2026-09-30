import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';

// 다른 모듈이 함수를 정의하기 전에 실행되어야 하므로 index.ts에서 가장 먼저 import한다.
initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });
