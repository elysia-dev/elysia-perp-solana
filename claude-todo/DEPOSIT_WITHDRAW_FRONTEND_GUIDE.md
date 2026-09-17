# Deposit & Withdraw 프론트엔드 구현 가이드

서버팀의 입출금 문서를 기반으로, 프론트엔드에서 구현해야 할 작업을 정리합니다.

> spot은 MVP 범위 밖이므로 모든 작업은 **perp (RouteType = 0)** 기준입니다.

---

## 현재 상태

| 항목           | 상태                            | 파일                                 |
| -------------- | ------------------------------- | ------------------------------------ |
| ElysiaPerp ABI | 준비 완료                       | `lib/contracts/abi/ElysiaPerpAbi.ts` |
| MockToken ABI  | 준비 완료                       | `lib/contracts/abi/MockTokenAbi.ts`  |
| 컨트랙트 주소  | 준비 완료                       | `lib/contracts/addresses.ts`         |
| Deposit 훅     | **mock 상태** (API 직접 호출)   | `lib/hooks/useDeposit.ts`            |
| Withdraw 훅    | **미구현**                      | -                                    |
| Withdraw UI    | **미구현** (console.log만 존재) | `components/header.tsx:104-106`      |

---

## 핵심 이해: Deposit vs Withdraw 경로 차이

```
Deposit (입금):
  유저 지갑 → [approve] → [deposit] → ElysiaPerp 컨트랙트 → 서버가 이벤트 감지 → 잔고 반영
  ※ 온체인 트랜잭션 2개 필요 (approve + deposit)
  ※ 서버 API 호출 불필요 — 서버가 블록체인 이벤트를 자동 감지

Withdraw (출금):
  유저 → POST /account/withdraw → 서버가 컨트랙트 withdraw 호출 → 토큰이 유저 지갑으로
  ※ 온체인 트랜잭션 불필요 — 서버(owner)가 대신 실행
  ※ API 호출 1개만 필요
```

---

## 작업 목록

### 1. Deposit 훅 재작성 (온체인 방식)

현재 `useDeposit.ts`는 `POST /account/deposit` API를 직접 호출하는 mock 방식입니다.
실제로는 **온체인 트랜잭션**으로 변경해야 합니다.

#### 흐름: approve → deposit

컨트랙트의 `deposit` 함수는 내부적으로 `safeTransferFrom`을 호출합니다.
이는 유저가 먼저 ElysiaPerp 컨트랙트에 토큰 사용을 **승인(approve)** 해야 한다는 뜻입니다.

```
1단계: allowance 확인
  MockToken.allowance(유저주소, ElysiaPerp주소) → 현재 허용량

2단계: approve (허용량이 부족할 때만)
  MockToken.approve(ElysiaPerp주소, amount)
  → 지갑 서명 → 블록 포함 대기

3단계: deposit
  ElysiaPerp.deposit(token주소, amount, 0)  // 0 = RouteType.PERP
  → 지갑 서명 → 블록 포함 대기
  → Deposit 이벤트 발생 → 서버가 자동 감지하여 잔고 반영
```

#### 사용할 컨트랙트 함수들

**MockToken (collateralToken):**

```ts
// 1. allowance 확인 (Read)
useReadContract({
  address: CONTRACTS[sepolia.id].collateralToken,
  abi: MockTokenAbi,
  functionName: "allowance",
  args: [userAddress, CONTRACTS[sepolia.id].elysiaPerp],
})

// 2. approve (Write)
mutate({
  address: CONTRACTS[sepolia.id].collateralToken,
  abi: MockTokenAbi,
  functionName: "approve",
  args: [CONTRACTS[sepolia.id].elysiaPerp, amount],
})
```

**ElysiaPerp:**

```ts
// 3. deposit (Write)
mutate({
  address: CONTRACTS[sepolia.id].elysiaPerp,
  abi: ElysiaPerpAbi,
  functionName: "deposit",
  args: [CONTRACTS[sepolia.id].collateralToken, amount, 0], // 0 = PERP
})
```

#### 구현 시 고려사항

- **approve 금액 전략**: 매번 정확한 금액만 approve하거나, `MaxUint256`로 한번에 무제한 승인할 수 있음. 무제한 승인은 UX가 좋지만 보안 리스크가 있음 (테스트넷이므로 무제한 OK)
- **allowance가 충분하면 approve 스킵**: 이미 충분한 allowance가 있으면 approve 단계 생략
- **2개의 트랜잭션 순서 보장**: approve가 블록에 포함된 후에 deposit 실행해야 함
- **잔고 반영 딜레이**: deposit 트랜잭션이 블록에 포함된 후에도 서버가 이벤트를 감지하는 데 최대 ~12초(poll_interval) 소요. 즉, deposit isSuccess 직후 balance를 조회하면 아직 반영 안 되었을 수 있음

#### 상태 흐름

```
[Deposit 클릭]
     │
     ▼  allowance 확인
  allowance < amount?
     │
     ├─ Yes: approve 트랜잭션 실행
     │    isPending (지갑 서명 대기)
     │    isConfirming (블록 포함 대기)
     │    approve 완료
     │         │
     ▼         ▼
  deposit 트랜잭션 실행
     isPending (지갑 서명 대기)
     isConfirming (블록 포함 대기)
     isSuccess → "Deposit 완료! 잔고 반영까지 잠시 기다려 주세요"
     │
     ▼  ~12초 후 서버가 이벤트 감지
  balance 갱신 (invalidateQueries)
```

---

### 2. Withdraw 훅 구현 (API 방식)

Withdraw는 온체인 트랜잭션이 아닌 **서버 API 호출**입니다.
서버(owner)가 컨트랙트의 `withdraw`를 대신 호출해줍니다.

#### API 스펙

```
POST /account/withdraw
Content-Type: application/json

{
  "asset_id": 4,           // USDT asset ID (서버 측 asset_id)
  "amount": "100.5",       // 출금할 금액 (사람이 읽는 수)
  "route_type": "perp"     // 기본값이 perp이므로 생략 가능
}
```

**성공 응답 (200):**

```json
{
  "id": 42,
  "address": "0xabc...",
  "asset_id": 4,
  "amount": "100.5",
  "route_type": "perp",
  "new_balance": "899.5"
}
```

**실패 (400):** 잔액 부족, 유효하지 않은 amount 등

#### 출금 상태 흐름 (서버 측)

프론트엔드가 API를 호출하면 서버 응답은 즉시 오지만, 실제 토큰 전송은 백그라운드에서 진행됩니다.

```
API 응답 (즉시)          서버 백그라운드              온체인
──────────────          ────────────────            ──────
200 OK (pending)   →    withdraw tx 전송    →       블록 포함
                        status: submitted           토큰 전송
                        status: confirmed           유저 지갑에 토큰 도착
```

- API 호출 성공 시점: 서버 잔고는 이미 차감됨, 하지만 지갑에 토큰이 아직 도착 안 함
- 토큰 실제 도착: 서버 백그라운드에서 컨트랙트 호출 후 블록 포함까지 대기 필요
- tx 실패 시: 서버가 자동으로 잔고 환불 (status: "refunded")

#### 구현 시 고려사항

- **asset_id**: 서버의 USDT asset_id를 확인해야 함 (문서에서 4로 표시, 현재 코드의 ASSET_IDS와 다를 수 있음)
- **amount**: 사람이 읽는 숫자 그대로 전송 (parseUnits 불필요, 서버가 변환 처리)
- **잔고 갱신**: 성공 시 balance 쿼리 invalidate
- **에러 처리**: 잔액 부족(400) 시 사용자에게 알림

---

### 3. Deposit UI 변경

현재 Popover 안의 Deposit 버튼(`header.tsx:261-273`)을 실제 온체인 deposit으로 연결해야 합니다.

#### 필요한 UI 요소

- **금액 입력 필드**: 입금할 USDT 금액 입력
- **Deposit 버튼**: 상태에 따라 텍스트 변경
  - `"Deposit"` → 초기
  - `"Approving..."` → approve 트랜잭션 진행 중
  - `"Depositing..."` → deposit 트랜잭션 진행 중
  - `"Deposit Complete"` → 완료
- **Wallet Balance 표시**: 현재 지갑의 토큰 잔고 (이미 구현됨)
- **Perp Balance 표시**: 서버 잔고 (이미 구현됨)

---

### 4. Withdraw UI 구현

현재 `handleWithdraw`는 `console.log("Withdraw")`만 있습니다.

#### 필요한 UI 요소

- **금액 입력 필드**: 출금할 USDT 금액 입력
- **Withdraw 버튼**: 상태에 따라 텍스트 변경
  - `"Withdraw"` → 초기
  - `"Withdrawing..."` → API 호출 중
  - `"Withdraw Requested"` → 성공 (서버에서 백그라운드 처리 중)
- **잔고 표시**: 출금 가능한 Perp 잔고

---

## 구현 우선순위

| 순서 | 작업                           | 난이도 | 설명                                               |
| ---- | ------------------------------ | ------ | -------------------------------------------------- |
| 1    | Withdraw 훅 + UI               | 낮음   | API 호출 1개, 기존 패턴(useDeposit mock)과 동일    |
| 2    | Deposit 훅 (approve + deposit) | 중간   | 온체인 트랜잭션 2개 순차 실행, allowance 확인 필요 |
| 3    | Deposit/Withdraw UI 개선       | 낮음   | 금액 입력 필드 추가, 상태별 버튼 텍스트            |

---

## 참고: 현재 코드와의 차이점

### useDeposit.ts (현재 mock → 온체인으로 변경 필요)

```
현재 (mock):
  POST /account/deposit → 서버가 직접 잔고 추가 (테스트용)

변경 후 (실제):
  approve(ElysiaPerp, amount) → deposit(token, amount, PERP) → 서버 이벤트 감지
```

### 참고할 기존 패턴

- `useMintToken.ts`: `useWriteContract` + `useWaitForTransactionReceipt` 패턴 참고
- `useDeposit.ts` (현재): `useMutation` + `invalidateQueries` 패턴 참고
- `useBalance.ts`: 잔고 조회 쿼리키 `["balance"]` — invalidate 시 이 키 사용

### 필요한 import들

```ts
// 온체인 Deposit 훅에서 필요
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi"
import { parseUnits, maxUint256 } from "viem"
import { ElysiaPerpAbi } from "@/lib/contracts/abi/ElysiaPerpAbi"
import { MockTokenAbi } from "@/lib/contracts/abi/MockTokenAbi"
import { CONTRACTS } from "@/lib/contracts/addresses"

// Withdraw 훅에서 필요
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
```
