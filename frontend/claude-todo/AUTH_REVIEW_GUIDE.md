# Auth 로직 코드 리뷰 가이드

## 1. 배경 설명

### 1.1 인증 방식 개요

이 프로젝트는 **EIP-712 서명 기반 인증**을 사용합니다. SIWE(Sign-In with Ethereum)와 유사한 방식으로, 사용자가 지갑으로 메시지에 서명하면 서버가 이를 검증하여 인증합니다.

```
[지갑 연결] → [Nonce 요청] → [EIP-712 서명] → [서버 검증] → [토큰 발급 (httpOnly 쿠키)]
```

### 1.2 토큰 관리 전략

| 쿠키            | 타입      | 용도                                  |
| --------------- | --------- | ------------------------------------- |
| `access_token`  | httpOnly  | API 인증 (서버만 접근)                |
| `refresh_token` | httpOnly  | 토큰 갱신 (서버만 접근)               |
| `logged_in`     | 일반 쿠키 | 클라이언트 상태 동기화 (JS 접근 가능) |

- **httpOnly 쿠키**: XSS 공격으로부터 토큰 보호
- **logged_in 쿠키**: 클라이언트가 인증 상태를 알 수 있도록 함 (실제 토큰 아님)

### 1.3 주요 흐름

1. **로그인**: 지갑 연결 → EIP-712 서명 → 서버에서 쿠키 설정
2. **API 호출**: httpOnly 쿠키 자동 전송 → 서버에서 검증
3. **토큰 갱신**: 401 발생 시 자동으로 `/auth/refresh` 호출
4. **로그아웃**: 지갑 연결 해제 또는 명시적 로그아웃 → 서버에서 쿠키 삭제

---

## 2. 핵심 파일 구조

```
lib/
├── providers/
│   └── AuthProvider.tsx    # 인증 상태 Context
├── hooks/
│   └── useAuth.ts          # 로그인/로그아웃 mutation
├── api/
│   └── client.ts           # API 클라이언트 + 자동 토큰 갱신
├── utils/
│   └── cookie.ts           # 클라이언트 쿠키 유틸리티
└── constants/
    └── eip712.ts           # EIP-712 서명 타입 정의

types/
└── auth.ts                 # 인증 관련 타입

components/
└── header.tsx              # 자동 로그인 UI 로직
```

---

## 3. 리뷰 체크리스트

### 3.1 AuthProvider.tsx

**파일 위치**: `lib/providers/AuthProvider.tsx`

#### 상태 관리

- [ ] `isAuthenticated`: 인증 여부 (서버의 `logged_in` 쿠키와 동기화)
- [ ] `isAuthReady`: 초기 쿠키 확인 완료 여부 (hydration 안전성)
- [ ] `isRefreshing`: 토큰 갱신 진행 중 여부
- [ ] `accountSwitched`: 계정 전환 감지 플래그

#### 리뷰 포인트

- [ ] **Hydration 안전성**: `isAuthenticated`가 `false`로 시작하여 hydration mismatch 방지
- [ ] **자동 갱신 시도**: 지갑 연결됨 + 로그인 쿠키 없음 → refresh 시도
- [ ] **지갑 연결 해제 감지**: `wasConnected` ref로 disconnect 감지 → 로그아웃 API 호출
- [ ] **계정 전환 감지**: `prevAddress` ref로 주소 변경 감지 → 로그아웃 후 재로그인 트리거

#### 주의사항

```tsx
// 중복 갱신 방지
const hasAttemptedRefresh = useRef(false)

// 이전 연결 상태 추적
const wasConnected = useRef(isConnected)
const prevAddress = useRef(address)
```

---

### 3.2 useAuth.ts

**파일 위치**: `lib/hooks/useAuth.ts`

#### 로그인 플로우 (loginMutation)

```
1. Nonce 요청 → GET /auth/nonce?address={address}
2. EIP-712 서명 → signTypedDataAsync()
3. 로그인 요청 → POST /auth/login (address, signature, nonce)
4. 상태 업데이트 → setAuthenticated(true)
```

#### 리뷰 포인트

- [ ] **EIP-712 도메인**: `name: "VEX"` - 서버와 일치해야 함 (변경 필요 시 서버와 동시 변경)
- [ ] **서명 거부 처리**: `isUserRejection()` 함수로 사용자 취소 감지 → 지갑 연결 해제
- [ ] **credentials**: `auth: true` 옵션으로 쿠키 전송 활성화

#### 주의사항

```tsx
// 서명 거부 시 지갑 연결 해제
if (isUserRejection(error)) {
  disconnect.mutate()
}
```

---

### 3.3 client.ts (API 클라이언트)

**파일 위치**: `lib/api/client.ts`

#### 자동 토큰 갱신 로직

```
API 호출 → 401 발생 → refreshToken() → 성공 시 원래 요청 재시도
```

#### 리뷰 포인트

- [ ] **싱글톤 갱신**: `refreshPromise`로 동시 401 요청들이 하나의 갱신 공유
- [ ] **Auth 엔드포인트 제외**: `/auth/*` 엔드포인트는 자동 갱신 스킵
- [ ] **에러 분류**: `ApiError` 클래스로 status, message, code 관리

#### 핵심 코드

```tsx
// 동시 갱신 방지 - 싱글톤 패턴
let refreshPromise: Promise<RefreshResult> | null = null

function refreshToken(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise // 기존 갱신 공유

  refreshPromise = (async () => {
    // ... 갱신 로직
  })()

  return refreshPromise
}
```

---

### 3.4 cookie.ts

**파일 위치**: `lib/utils/cookie.ts`

#### 리뷰 포인트

- [ ] **SSR 안전성**: `typeof document === "undefined"` 체크
- [ ] **logged_in 쿠키만 확인**: 실제 토큰(httpOnly)은 접근 불가

---

### 3.5 eip712.ts

**파일 위치**: `lib/constants/eip712.ts`

#### 리뷰 포인트

- [ ] **도메인 이름**: `name: "VEX"` - 변경 필요 시 서버와 동시 변경 필수
- [ ] **chainId**: 런타임에 동적 설정
- [ ] **LoginMessage 타입**: `user` (address) + `nonce` (string)

#### 변경 시 주의

```tsx
// 이 값들은 서버의 EIP-712 검증 로직과 정확히 일치해야 함
export const EIP712_DOMAIN = {
  name: "ELSIA_PERP", // ⚠️ 서버와 동일해야 함
  version: "1", // ⚠️ 서버와 동일해야 함
}
```

---

### 3.6 header.tsx (자동 로그인)

**파일 위치**: `components/header.tsx`

#### 자동 로그인 조건

1. 지갑이 `connected` 상태로 전환됨
2. `isAuthReady` = true (쿠키 확인 완료)
3. `isAuthenticated` = false (아직 로그인 안 됨)
4. `isRefreshing` = false (갱신 진행 중 아님)
5. `hasAttemptedLogin` = false (아직 시도 안 함)

#### 리뷰 포인트

- [ ] **Hydration 안전성**: `mounted` 상태로 클라이언트 렌더링 보장
- [ ] **중복 로그인 방지**: `hasAttemptedLogin` ref 사용
- [ ] **계정 전환 처리**: `accountSwitched` 플래그로 재로그인 트리거
- [ ] **딜레이**: `setTimeout(..., 300)` - 지갑/로그아웃 완료 대기

---

## 4. 보안 고려사항

### 4.1 현재 구현된 보안

- [x] httpOnly 쿠키로 토큰 저장 (XSS 방지)
- [x] EIP-712 구조화된 서명 (피싱 방지)
- [x] Nonce 기반 재전송 공격 방지
- [x] 자동 토큰 갱신

### 4.2 추가 검토 필요

- [ ] CSRF 보호 (SameSite 쿠키 설정 확인)
- [ ] Nonce 만료 시간 검증
- [ ] Rate limiting (서버 측)

---

## 5. 테스트 시나리오

### 5.1 기본 플로우

- [ ] 지갑 연결 → 자동 로그인 → 서명 → 인증 완료
- [ ] 페이지 새로고침 → 인증 상태 유지
- [ ] 지갑 연결 해제 → 자동 로그아웃

### 5.2 엣지 케이스

- [ ] 서명 거부 → 지갑 연결 해제 + 안내 메시지
- [ ] 계정 전환 → 자동 로그아웃 → 새 계정 로그인
- [ ] 토큰 만료 → 자동 갱신 → 원래 요청 재시도
- [ ] 갱신 토큰 만료 → 재로그인 필요

### 5.3 동시성

- [ ] 여러 API 동시 호출 중 401 → 갱신 한 번만 실행
- [ ] 빠른 페이지 이동 중 인증 상태 유지

---

## 6. 관련 파일 빠른 참조

| 파일                                                  | 핵심 역할                        |
| ----------------------------------------------------- | -------------------------------- |
| [AuthProvider.tsx](../lib/providers/AuthProvider.tsx) | 인증 상태 Context, 자동 로그아웃 |
| [useAuth.ts](../lib/hooks/useAuth.ts)                 | EIP-712 서명, 로그인 mutation    |
| [client.ts](../lib/api/client.ts)                     | API 호출, 자동 토큰 갱신         |
| [cookie.ts](../lib/utils/cookie.ts)                   | logged_in 쿠키 확인              |
| [eip712.ts](../lib/constants/eip712.ts)               | 서명 타입 정의                   |
| [header.tsx](../components/header.tsx)                | 자동 로그인 UI                   |
| [auth.ts](../types/auth.ts)                           | 인증 타입 정의                   |
