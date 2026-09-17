# 입출금 (Deposit & Withdraw) 프로세스

## 개요

입출금은 L1 블록체인(EVM)의 `ElysiaPerp` 컨트랙트와 오프체인 서버 간의 상호작용으로 처리된다.

- **입금**: 유저가 컨트랙트에 토큰을 보내면, 서버가 이벤트를 감지하여 잔고를 반영
- **출금**: 유저가 서버에 요청하면, 서버(owner)가 컨트랙트의 `withdraw`를 직접 호출하여 토큰 전송
- **이체**: `POST /account/transfer`로 perp ↔ spot 간 잔고 이동

```
입금: User → Contract.deposit(token, amount, routeType) → Event → DepositService → 해당 엔진 잔고 반영
출금: User → POST /account/withdraw → DepositService → Contract.withdraw(user, token, amount) → 토큰 전송
이체: User → POST /account/transfer → source 엔진 차감 + destination 엔진 증가
```

### RouteType (잔고 분리)

입금/출금/잔고는 `route_type`으로 **perp**와 **spot** 엔진에 분리 저장된다.

| route_type      | 인메모리 엔진    | 용도             |
| --------------- | ---------------- | ---------------- |
| `perp` (기본값) | `PerpRiskEngine` | 무기한 선물 마진 |
| `spot`          | `RiskEngine`     | 현물 주문        |

- 입금 시 컨트랙트의 `RouteType` enum (0=PERP, 1=SPOT)으로 지정
- 출금/mock_deposit 시 `route_type` 필드로 지정 (기본값: `"perp"`)
- `POST /account/transfer`로 perp ↔ spot 간 이체 가능

---

## 스마트 컨트랙트

**파일:** `contracts/src/ElysiaPerp.sol`

UUPS 프록시 패턴으로 업그레이드 가능. 프록시 주소가 `DEPOSIT_CONTRACT_ADDRESS`로 설정된다.

```solidity
contract ElysiaPerp is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    enum RouteType { PERP, SPOT }

    mapping(address token => bool) public supportedTokens;

    function initialize(address initialOwner) external initializer;
    function deposit(address token, uint256 amount, RouteType routeType) external whenNotPaused;
    function withdraw(address user, address token, uint256 amount) external onlyOwner whenNotPaused nonReentrant;
}
```

| 함수               | 호출 주체          | 설명                                                                         |
| ------------------ | ------------------ | ---------------------------------------------------------------------------- |
| `initialize`       | 프록시 배포 시 1회 | owner 설정                                                                   |
| `deposit`          | 유저               | 토큰을 컨트랙트로 전송, `Deposit` 이벤트 발생 (routeType으로 perp/spot 지정) |
| `withdraw`         | 서버 (owner)       | 유저에게 직접 토큰 전송                                                      |
| `upgradeToAndCall` | owner              | 새 구현체로 업그레이드                                                       |

이벤트:

- `Deposit(address indexed user, address indexed token, uint256 amount, RouteType routeType)`
- `Withdraw(address indexed user, address indexed token, uint256 amount)`

---

## 잔고 저장소

잔고는 **3곳**에 동시 저장되며, 항상 동기 상태를 유지해야 한다.

| 저장소                         | 타입                            | route_type | 용도                                                       |
| ------------------------------ | ------------------------------- | ---------- | ---------------------------------------------------------- |
| `RiskEngine.user_balances`     | `HashMap<u64, BalanceStore>`    | `spot`     | 현물 주문 리스크 체크                                      |
| `PerpRiskEngine.user_balances` | `HashMap<u64, BalanceStore>`    | `perp`     | 선물 주문 리스크 체크                                      |
| `balances` 테이블 (DB)         | `available, locked, route_type` | 둘 다      | 영구 저장, 서버 재시작 시 route_type 필터로 각 엔진에 로드 |

`BalanceStore` 내부 구조 (`common/src/user_profile.rs`):

```
BalanceStore {
    balances: AHashMap<(user_id, asset_id), UserBalance { available: u64, locked: u64 }>
}
```

> 내부 단위 변환: 유저가 보는 USDT 금액 × 10^18 = internal units (u64)

---

## 입금 (Deposit) 흐름

### 전체 흐름

```
User                         Contract                 DepositService              DB
 │                              │                          │                      │
 ├─ deposit(token,amt,route) ──→│                          │                      │
 │                              ├─ emit Deposit ─────────→│                      │
 │                              │                          ├─ idempotency check ─→│
 │                              │                          │←── (tx_hash 중복?) ──┤
 │                              │                          │                      │
 │                              │                          ├─ find_or_create user→│
 │                              │                          │                      │
 │                              │                          ├─ route_type에 따라:
 │                              │                          │   perp → PerpRiskEngine.available += amt
 │                              │                          │   spot → RiskEngine.available += amt
 │                              │                          ├─ balances upsert (route_type) →│
 │                              │                          ├─ deposit_events (route_type) ──→│
 │                              │                          │                      │
```

### 상세 단계

**1. 유저가 컨트랙트에 입금**

- `deposit(token, amount, routeType)` 호출 (routeType: PERP=0, SPOT=1)
- `safeTransferFrom`으로 토큰이 컨트랙트로 이동
- `Deposit(user, token, amount, routeType)` 이벤트 발생

**2. DepositService 이벤트 폴링** (`server/src/deposit/service.rs:85-138`)

- 매 `poll_interval_ms` (기본 12초)마다 실행
- `eth_getLogs`로 마지막 처리 블록 이후의 `Deposit` 이벤트 조회
- 마지막 처리 블록은 `deposit_events` 테이블의 `MAX(block_number)`로 결정

**3. 이벤트 처리** (`server/src/deposit/service.rs:150-307`)

```
1. 멱등성 체크: (tx_hash, log_index)가 deposit_events에 이미 존재하면 skip
2. 이벤트 디코딩: log_decode::<Deposit>() → (user, token, amount, routeType)
3. 금액 변환: U256 → Decimal (÷ 10^usdt_decimals) → u64 (× 10^18)
4. routeType 변환: 0 → Perp, 1 → Spot
5. 유저 조회/생성: address → user_id (users 테이블)
6. route_type에 따라 단일 엔진 잔고 반영:
   - perp → PerpRiskEngine.user_balances[user_id][asset_id].available += amount
   - spot → RiskEngine.user_balances[user_id][asset_id].available += amount
7. DB 잔고 반영: balances 테이블 upsert (available += amount, route_type 필터)
8. 이벤트 기록: deposit_events 테이블 insert (status="processed", route_type)
```

### 입금 에러 처리

- **RPC 연결 실패**: 로그 후 다음 주기에 재시도
- **이벤트 디코딩 실패**: 해당 이벤트 skip, 나머지 계속 처리
- **DB 에러**: 해당 이벤트 skip (다음 주기에 멱등성 체크로 재처리)

---

## 출금 (Withdraw) 흐름

### 전체 흐름

```
User              Server                  DepositService            Contract
 │                  │                          │                      │
 ├─ POST /withdraw→ │                          │                      │
 │                  ├─ 잔고 검증 & 차감         │                      │
 │                  ├─ withdrawal_requests      │                      │
 │                  │   (status=pending)        │                      │
 │←─ 200 OK ───────┤                          │                      │
 │                  │                          │                      │
 │                  │    [background loop]      │                      │
 │                  │                          ├─ query pending ──────→│
 │                  │                          ├─ withdraw(user,token,amt)→│
 │                  │                          ├─ status=submitted     │
 │                  │                          │                      │
 │                  │                          ├─ check receipt ──────→│
 │                  │                          ├─ status=confirmed     │── 토큰 전송 → User
```

서버(owner)가 컨트랙트의 `withdraw`를 직접 호출하여 유저에게 토큰을 전송한다. 유저의 온체인 호출은 불필요.

### Phase 1: 출금 요청 (유저 → 서버)

**엔드포인트:** `POST /account/withdraw`

**요청:**

```json
{ "asset_id": 4, "amount": "100.5", "route_type": "perp" }
```

> `route_type` 생략 시 기본값 `"perp"`

**처리 순서:**

```
1. 검증: amount > 0, asset_id 유효, USDT 출금만 지원
2. 금액 변환: Decimal → u64 internal units (× 10^18)
3. route_type에 따라 단일 엔진 잔고 차감:
   └─ perp → PerpRiskEngine.available -= amount
   └─ spot → RiskEngine.available -= amount
   └─ available < amount → 400 Bad Request
4. DB 잔고 차감:
   └─ balances.available -= amount (WHERE route_type = ?)
   └─ 실패 시 → 인메모리 롤백 (해당 엔진만)
5. withdrawal_requests insert (status="pending", route_type)
   └─ 실패 시 → 인메모리 롤백
```

**응답:**

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

### Phase 2: 온체인 출금 (서버 백그라운드)

**메서드:** `process_pending_withdrawals()`

```
매 폴링 주기마다:
1. withdrawal_requests WHERE status="pending" ORDER BY id LIMIT 10
2. owner_private_key로 서명자 생성
3. 각 요청에 대해:
   - amount: Decimal → U256 (× 10^usdt_decimals)
   - contract.withdraw(user, token, amount) 트랜잭션 전송
   - 성공 → status="submitted", tx_hash 저장
   - 실패 → status="pending" 유지 (다음 주기 재시도)
```

> `DEPOSIT_OWNER_PRIVATE_KEY` 미설정 시 이 단계는 skip된다.

### Phase 3: 트랜잭션 확인 (서버 백그라운드)

**메서드:** `confirm_submitted_withdrawals()`

```
매 폴링 주기마다:
1. withdrawal_requests WHERE status="submitted" ORDER BY id LIMIT 10
2. 각 요청에 대해:
   - provider.get_transaction_receipt(tx_hash)
   - receipt 있음 + status() = true  → status="confirmed"
   - receipt 있음 + status() = false → 잔고 환불 (인메모리 + DB) → status="refunded"
   - receipt 없음 → skip (아직 pending, 다음 주기 재확인)
```

---

## 출금 상태 전이

```
pending ──→ submitted ──→ confirmed
                    └──→ refunded
```

| 상태        | 의미                             | 서버 잔고   | 컨트랙트 상태 |
| ----------- | -------------------------------- | ----------- | ------------- |
| `pending`   | 요청 접수, 온체인 미처리         | 이미 차감됨 | 변경 없음     |
| `submitted` | `withdraw` tx 전송됨             | 이미 차감됨 | tx pending    |
| `confirmed` | tx 성공, 토큰 유저에게 전송 완료 | 이미 차감됨 | 토큰 전송됨   |
| `refunded`  | tx revert, 잔고 환불됨           | 복원됨      | 변경 없음     |

---

## 출금 롤백 전략

**요청 단계 (Phase 1):** 인메모리 차감 후 DB 작업 실패 시, 해당 엔진만 원상복구한다.

```
실패 시점                   롤백 대상
────────────────────────────────────────────────
DB balances 업데이트 실패   → 해당 엔진 복원 (perp → PerpRiskEngine, spot → RiskEngine)
withdrawal_requests 실패    → 해당 엔진 복원
                             (DB balance는 이미 차감됨 — edge case)
```

**확인 단계 (Phase 3):** 온체인 tx가 revert된 경우, 자동으로 잔고를 환불한다.

```
1. 해당 route_type의 인메모리 엔진에 available += amount
2. DB balances.available += amount (WHERE route_type = ?)
3. status → "refunded"
```

---

## 내부 이체 (Transfer)

**엔드포인트:** `POST /account/transfer`

**요청:**

```json
{ "from": "perp", "to": "spot", "asset_id": 4, "amount": "100" }
```

**처리 순서:**

```
1. 검증: from ≠ to, amount > 0
2. Lock 순서: 항상 risk_engine → perp_risk_engine (데드락 방지)
3. source 엔진 잔고 차감 (available < amount → 400)
4. destination 엔진 잔고 증가
5. DB: source balance row 차감, destination balance row 증가 (upsert)
6. DB 실패 시 → 인메모리 롤백 (source 복원, destination 차감)
```

**응답:**

```json
{
  "from": "perp",
  "to": "spot",
  "asset_id": 4,
  "amount": "100",
  "from_balance": "900",
  "to_balance": "100"
}
```

---

## DB 스키마

### `deposit_events` 테이블

| 컬럼            | 타입           | 설명                             |
| --------------- | -------------- | -------------------------------- |
| `id`            | BIGINT PK      | 자동 증가                        |
| `tx_hash`       | VARCHAR(66)    | 트랜잭션 해시 (0x 포함)          |
| `log_index`     | INT            | 로그 인덱스                      |
| `user_address`  | VARCHAR(42)    | 입금자 주소                      |
| `user_id`       | BIGINT FK      | users.id                         |
| `token_address` | VARCHAR(42)    | 토큰 컨트랙트 주소               |
| `amount`        | DECIMAL(36,18) | 입금 금액                        |
| `block_number`  | BIGINT         | 블록 번호                        |
| `route_type`    | VARCHAR(10)    | `perp` / `spot` (기본값: `perp`) |
| `status`        | VARCHAR(20)    | 항상 "processed"                 |
| `created_at`    | TIMESTAMPTZ    | 처리 시각                        |

인덱스: `UNIQUE(tx_hash, log_index)`, `(user_id)`, `(block_number)`

### `withdrawal_requests` 테이블

| 컬럼            | 타입             | 설명                                     |
| --------------- | ---------------- | ---------------------------------------- |
| `id`            | BIGINT PK        | 자동 증가                                |
| `user_id`       | BIGINT FK        | users.id                                 |
| `user_address`  | VARCHAR(42)      | 출금 수신 주소                           |
| `token_address` | VARCHAR(42)      | 토큰 컨트랙트 주소                       |
| `asset_id`      | INT              | 자산 ID                                  |
| `amount`        | DECIMAL(36,18)   | 출금 금액                                |
| `route_type`    | VARCHAR(10)      | `perp` / `spot` (기본값: `perp`)         |
| `status`        | VARCHAR(20)      | pending → submitted → confirmed/refunded |
| `tx_hash`       | VARCHAR(66) NULL | approveWithdrawal tx hash                |
| `created_at`    | TIMESTAMPTZ      | 요청 시각                                |
| `updated_at`    | TIMESTAMPTZ      | 상태 변경 시각                           |

인덱스: `(user_id)`, `(status)`

### `balances` 테이블

| 컬럼         | 타입           | 설명                             |
| ------------ | -------------- | -------------------------------- |
| `id`         | BIGINT PK      | 자동 증가                        |
| `user_id`    | BIGINT FK      | users.id                         |
| `asset_id`   | INT FK         | assets.id                        |
| `route_type` | VARCHAR(10)    | `perp` / `spot` (기본값: `perp`) |
| `available`  | DECIMAL(36,18) | 사용 가능 잔고                   |
| `locked`     | DECIMAL(36,18) | 주문에 잠긴 잔고                 |
| `created_at` | TIMESTAMPTZ    | 생성 시각                        |
| `updated_at` | TIMESTAMPTZ    | 변경 시각                        |

인덱스: `UNIQUE(user_id, asset_id, route_type)`

---

## 환경변수

| 변수                        | 필수 | 기본값             | 설명                      |
| --------------------------- | ---- | ------------------ | ------------------------- |
| `DEPOSIT_RPC_URL`           | Y    | -                  | 블록체인 RPC 엔드포인트   |
| `DEPOSIT_CONTRACT_ADDRESS`  | Y    | -                  | ElysiaPerp 컨트랙트 주소  |
| `DEPOSIT_USDT_ADDRESS`      | Y    | -                  | USDT 토큰 컨트랙트 주소   |
| `DEPOSIT_USDT_ASSET_ID`     | N    | `vex_config::USDT` | 내부 asset ID             |
| `DEPOSIT_USDT_DECIMALS`     | N    | `6`                | 토큰 소수점 자릿수        |
| `DEPOSIT_POLL_INTERVAL_MS`  | N    | `12000`            | 이벤트 폴링 주기 (ms)     |
| `DEPOSIT_START_BLOCK`       | N    | `0`                | 이벤트 스캔 시작 블록     |
| `DEPOSIT_OWNER_PRIVATE_KEY` | N    | -                  | 출금 승인 서명용 owner 키 |

> `DEPOSIT_OWNER_PRIVATE_KEY` 미설정 시 입금 리스너만 동작, 출금 자동 승인은 비활성화.

---

## 파일 구조

```
contracts/src/ElysiaPerp.sol        # 스마트 컨트랙트 (UUPS upgradeable, RouteType enum)
contracts/script/deploy/            # 배포 스크립트 (001_DeployElysiaPerp.s.sol)
contracts/deployments/              # 체인별 배포 주소 JSON (<chainId>-deploy.json)
server/src/
  deposit/
    config.rs                       # DepositConfig (환경변수 파싱)
    service.rs                      # DepositService (이벤트 폴링, 출금 처리)
    mod.rs
  handlers/
    account.rs                      # POST /account/withdraw, POST /account/transfer 핸들러
  bin/main.rs                       # DepositService 백그라운드 시작
entity/src/
  deposit_events.rs                 # 입금 이벤트 엔티티 (route_type 포함)
  withdrawal_requests.rs            # 출금 요청 엔티티 (route_type 포함)
  balances.rs                       # 잔고 엔티티 (route_type 포함)
migration/src/
  m20260210_000001_create_tables.rs # 테이블 스키마
  m20260212_000001_add_route_type.rs # route_type 컬럼 추가 마이그레이션
common/src/
  user_profile.rs                   # BalanceStore, UserBalance
  route_type.rs                     # RouteType enum (Perp, Spot)
```
