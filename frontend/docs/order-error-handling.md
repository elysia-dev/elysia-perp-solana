# 주문 에러 처리 정리 (Order Error → Toast)

주문/입출금 실패 시 백엔드가 던지는 에러를 **사용자에게 어떤 토스트로 보여줄지** 정리한 문서.

배경: `apiClient`는 백엔드 응답의 `error` 필드를 `ApiError.message`로, `code` 필드를 `ApiError.code`로 던진다. 주문 폼은 이 메시지를 토스트의 `Reason` 줄에 표시한다(`perp-trading-form.tsx` `onError`).

**백엔드 확인 결과 (Rust, `server/src/error.rs` · `processors/src/error.rs`):**

1. **주문 에러에는 `code`가 없다.** `AppError`는 응답 바디로 `{ "error": <message> }`만 직렬화한다(`ErrorResponse`). `code`를 함께 주는 건 **인증 에러(`AuthError`)뿐**(`MISSING_AUTH_COOKIE` 등). → 주문 에러는 **메시지 문자열로만 매칭** 가능.
2. **메시지가 Rust Debug 래퍼로 감싸져 온다.** 엔진 에러가 `BadRequest("insufficient margin: ...")` 형태로 `error` 필드에 들어온다. 프론트에서 **래퍼를 벗긴 뒤** 매칭/표시한다.
3. **숫자는 스케일된 정수.** 노셔널/마진은 `NOTIONAL_SCALE = 10^6`(= $1) 단위(예: `required 1121030` ≈ 1.12). 수량/가격은 마켓별 `size_decimals`/`price_decimals`.

이 정리를 **프론트 전용**으로 처리한다 — 백엔드 변경 없이 `lib/utils/orderError.ts`의 `toOrderErrorReason()`가 래퍼 제거 → 친화적 문구 매핑 → 미매핑 시 정리된 원문 폴백.

---

## 스케일 디코딩 기준

백엔드는 정수 스케일 값을 쓴다. 마켓별 자릿수는 `/orderBookDetails`의 각 항목에서 온다.

| 필드             | 의미               | 예 (BTC-PERP-EL)         | 예 (ETH-PERP-EL)   |
| ---------------- | ------------------ | ------------------------ | ------------------ |
| `size_decimals`  | 수량 자릿수        | 5 (1 = 0.00001 BTC)      | 4 (1 = 0.0001 ETH) |
| `price_decimals` | 가격 자릿수        | 1 (652308 = 65230.8)     | 2                  |
| `quote_decimals` | 마진/노셔널 자릿수 | 6 (1121030 = 1.12103 EL) | 6                  |

> `insufficient margin`의 `required`/`available`, 노셔널 등 **금액성 값은 `quote_decimals`(=6)** 로 나눈다. 수량은 `size_decimals`, 가격은 `price_decimals`.

---

## 에러 카탈로그

### 1. 최소 주문 수량 미달 — `invalid order arguments`

- **백엔드 메시지**: `invalid order arguments: price <p>, size <s>`
- **확인된 사례**: `price 652308, size 1` → size 1(=0.00001 BTC)이 거부됨. 같은 마켓에서 size 18(=0.00018)은 성공. 즉 수량이 거래소 최소 단위보다 작음. (가격/스케일은 정상)
- **원인**: 주문 수량이 매칭 엔진 최소 주문 수량 미만. (드물게 가격 틱 위반도 같은 메시지 가능)
- **권장 토스트(Reason)**: `Order size is too small. Try a larger amount.`
- **사전 검증 가능?** △ — 정확한 최소값이 `/orderBookDetails`에 노출 안 됨. 경험적으로 임계값 확정 후 프론트 min-size 검증 추가 가능.

### 2. 마진 부족 — `insufficient margin`

- **백엔드 메시지**: `insufficient margin: user_id <id>, required <r>, available <a>`
- **확인된 사례**: `required 1121030, available 678343` → 필요 1.121 EL vs 가용 0.678 EL (quote_decimals=6).
- **원인**: 주문 노셔널 × IMF가 가용 마진을 초과. 기존 포지션이 마진을 점유 중이면 추가 주문에서 자주 발생.
- **권장 토스트(Reason)**: `Insufficient margin. Reduce size, raise leverage, or deposit more.`
  - (선택) 디코딩한 수치를 덧붙이면 더 친절: `Need ≈1.12 EL, have ≈0.68 EL.`
- **사전 검증 가능?** ✅ — 폼이 노셔널/마진을 이미 계산함(`isPlaceable`의 `getNetMarginRequired`). 제출 전 버튼에서 막을 수 있음.

### 3. 유동성 부족 (시장가) — 미확정

- **백엔드 메시지(추정)**: `insufficient liquidity` 또는 부분 체결 거부류
- **상황**: 시장가 주문인데 반대편 호가가 없거나 얇아 체결 불가. (현재 BTC-PERP-EL은 asks=0, bids 1건 0.00002로 매우 얇음)
- **권장 토스트(Reason)**: `Not enough liquidity to fill at market. Try a smaller size or use a Limit order.`
- **사전 검증 가능?** △ — 오더북 깊이로 추정 경고는 가능하나, 최종 판단은 백엔드.
- **TODO**: 실제 백엔드 메시지 문자열 확인 후 매핑 키 확정.

### 4. 세션 만료 / 인증 — `MISSING_AUTH_COOKIE` / 401

- **코드**: `ApiError.code === "MISSING_AUTH_COOKIE"` 또는 `status === 401`
- **처리**: `apiClient`가 자동 refresh+재시도. 그래도 실패하면 재로그인 필요.
- **권장 토스트(Reason)**: `Session expired. Please sign in again.`
- **비고**: 가능하면 토스트보다 재로그인 플로우로 유도(헤더 auto-login). 주문 토스트엔 위 문구만.

### 5. 네트워크/서버 오류 — `NETWORK_ERROR` / 5xx

- **코드**: `ApiError.code === "NETWORK_ERROR"` 또는 `status >= 500`
- **권장 토스트(Reason)**: `Network error. Check your connection and try again.`

### 6. 그 외 / 미매핑 — 폴백

- 위 패턴에 안 걸리면 **백엔드 원본 메시지를 그대로** 표시(현재 동작 유지). 새 에러를 놓치지 않기 위함.

---

## 매핑 전략 (구현 완료)

**구현됨**: `lib/utils/orderError.ts` → `toOrderErrorReason(err)`. 주문 `onError`에서 `reason: toOrderErrorReason(error)`로 토스트 `Reason`에 전달(`perp-trading-form.tsx`).

동작:

1. `ApiError.code`가 있으면(인증) 코드로 먼저 매칭.
2. 그 외엔 `BadRequest("...")` Debug 래퍼를 벗긴 뒤 메시지 패턴으로 매칭.
3. `insufficient margin`은 `required`/`available`를 캡처해 `/10^6`로 디코딩, "need ≈1.12 EL, have ≈0.68 EL"처럼 수치까지 표기.
4. 미매핑은 **벗겨낸 원문**을 그대로 노출(새 에러 은폐 방지).

커버하는 백엔드 에러(`processors/src/error.rs` PerpRiskEngineError + 핸들러 BadRequest):

| 백엔드 메시지(벗긴 후)                                | 프론트 문구                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `insufficient margin: …`                              | Insufficient margin (need ≈X EL, have ≈Y EL). Reduce size, raise leverage, or deposit more.   |
| `invalid order arguments: …`                          | Order size is too small or invalid. Try a larger amount.                                      |
| `invalid leverage: L. Must be MIN-MAX`                | Invalid leverage. Must be between MIN and MAX.                                                |
| `reduce_only … no existing position`                  | No open position to reduce.                                                                   |
| `reduce_only … would increase position`               | Reduce-only orders can't increase your position.                                              |
| `reduce_only order size … exceeds position size …`    | Reduce-only size exceeds your current position.                                               |
| `order quote notional … exceeds market … limit`       | Order value exceeds this market's per-order limit.                                            |
| `open interest cap exceeded …`                        | Market open-interest cap reached. Try a smaller size or later.                                |
| `Maximum open orders … reached`                       | Too many open orders in this market. Cancel some first.                                       |
| `Margin shortfall during settlement: …`               | Couldn't fill at the available price (margin shortfall). Try a smaller size or a limit order. |
| `insufficient liquidity` / `no liquidity`             | Not enough liquidity to fill at market. Try a smaller size or a limit order.                  |
| `Unknown market …` / `market specification not found` | This market isn't available right now.                                                        |
| `Mark price not available …`                          | Price feed unavailable. Please try again shortly.                                             |
| (인증) code `MISSING_AUTH_COOKIE`                     | Session expired. Please sign in again.                                                        |
| (네트워크) code `NETWORK_ERROR`/`REFRESH_FAILED`      | Network error. Check your connection and try again.                                           |

- 동일 헬퍼를 deposit/withdraw 토스트에도 재사용 가능(추후).

## 원칙

1. **문구는 영어** — 앱의 기존 사용자 문구(예: "Insufficient Balance")와 통일. 추후 i18n 시 한 곳에서 교체.
2. **사전 차단 우선** — 마진 부족(2)·최소 수량(1)처럼 프론트가 미리 알 수 있는 건 버튼에서 막아 실패 토스트 자체를 줄인다.
3. **미매핑은 원본 노출** — 새/희귀 에러를 숨기지 말고 raw 메시지를 보여 추적 가능하게 한다.

## 남은 일 (TODO)

- [x] `toOrderErrorReason` 헬퍼 구현 + 주문 토스트에 연결 (`lib/utils/orderError.ts`)
- [ ] 시장가 유동성 부족 시 백엔드 실제 메시지 문자열 확정 → 매핑 키 정밀화 (현재는 `insufficient liquidity` 추정 매칭)
- [ ] BTC/ETH 등 마켓별 **최소 주문 수량** 임계값 확정 → 주문 전 사전 검증(버튼 비활성) 추가
- [ ] deposit/withdraw 토스트에도 동일 헬퍼 재사용
