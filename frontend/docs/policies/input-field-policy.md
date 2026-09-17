# 주문 폼 입력창 정책

> **대상 파일**: `elysia-perp-ui/components/perp-trading-form.tsx`
> **최종 업데이트**: 2026-04-09

---

## 1. 마켓 파라미터

| 마켓     | `base_scale_k` | `baseDecimals` | `quote_scale_k` | `quoteDecimals` | `minBaseStep` |
| -------- | -------------- | -------------- | --------------- | --------------- | ------------- |
| BTC-PERP | 100,000        | 5              | 10              | 1               | 0.00001       |
| ETH-PERP | 10,000         | 4              | 100             | 2               | 0.0001        |

- `baseDecimals = log10(base_scale_k)` — base 수량의 소수점 자릿수
- `quoteDecimals = log10(quote_scale_k)` — quote 금액 및 가격의 소수점 자릿수
- `minBaseStep = 1 / base_scale_k` — 최소 주문 수량 단위

---

## 2. Position Size 입력창

### 2.1 입력 모드

사용자는 **base** (BTC, ETH) 또는 **quote** (EL$) 모드를 선택할 수 있다. 내부적으로 `amount` (base 수량)가 항상 store에 저장된다.

| 입력 모드 | 사용자 입력  | 저장되는 값                          | 변환 수식               |
| --------- | ------------ | ------------------------------------ | ----------------------- |
| base      | BTC/ETH 수량 | `amount = 입력값`                    | —                       |
| quote     | EL$ 금액     | `amount = quoteInput / displayPrice` | `toFixed(baseDecimals)` |

### 2.2 소수점 정책

| 모드  | 최대 소수점 자릿수               | 검증 함수                             |
| ----- | -------------------------------- | ------------------------------------- |
| base  | `baseDecimals` (BTC: 5, ETH: 4)  | `exceedsDecimals(raw, baseDecimals)`  |
| quote | `quoteDecimals` (BTC: 1, ETH: 2) | `exceedsDecimals(raw, quoteDecimals)` |

### 2.3 최대 입력 길이

소수점(`.`) 포함 전체 문자 수 기준.

| 마켓 | base 모드 | quote 모드 | 예시 (base)          |
| ---- | --------- | ---------- | -------------------- |
| BTC  | 10자리    | 12자리     | `9999.99999` (10자)  |
| ETH  | 11자리    | 12자리     | `999999.9999` (11자) |

### 2.4 최소 주문 검증 (quote 모드)

quote 모드에서 입력한 금액이 최소 1 lot을 구매할 수 없으면 주문 버튼 비활성화.

```
조건: quoteInput < displayPrice / base_scale_k
```

| 마켓 | 최소 quote 금액 공식  | 예시 (mark price 기준) |
| ---- | --------------------- | ---------------------- |
| BTC  | `markPrice / 100,000` | $85,000 → $0.85        |
| ETH  | `markPrice / 10,000`  | $1,600 → $0.16         |

- 버튼 비활성화 + 텍스트 `"Enter Amount"` 유지
- `isPlaceable()`, `getButtonText()` 모두에서 검증

### 2.5 placeholder

| 모드  | 형식                       | BTC 예시  | ETH 예시 |
| ----- | -------------------------- | --------- | -------- |
| base  | `0.` + `0` × baseDecimals  | `0.00000` | `0.0000` |
| quote | `0.` + `0` × quoteDecimals | `0.0`     | `0.00`   |

---

## 3. Limit Price 입력창

Limit 주문 선택 시에만 노출.

### 3.1 소수점 정책

| 마켓 | 최대 소수점 자릿수      | 틱 사이즈 |
| ---- | ----------------------- | --------- |
| BTC  | 1자리 (`quoteDecimals`) | $0.1      |
| ETH  | 2자리 (`quoteDecimals`) | $0.01     |

### 3.2 자연수 자릿수 제한

소수점/소수부와 별도로, 정수 부분의 최대 자릿수를 제한.

```
priceMaxIntDigits = 10 - quoteDecimals
```

| 마켓 | 정수 최대 자릿수 | 최대 가격 (이론값) | 산출 근거                        |
| ---- | ---------------- | ------------------ | -------------------------------- |
| BTC  | 9자리            | $999,999,999.9     | u32::MAX / quote_scale_k ≈ $429M |
| ETH  | 8자리            | $99,999,999.99     | u32::MAX / quote_scale_k ≈ $43M  |

### 3.3 입력 검증 순서

```
1. regex: /^\d*\.?\d*$/ (숫자와 소수점만 허용)
2. intPart.length > priceMaxIntDigits → reject
3. exceedsDecimals(raw, quoteDecimals) → reject
4. setOrderPrice(raw)
```

---

## 4. base ↔ quote 전환 처리

### 4.1 입력 소스 추적

`inputSourceRef`와 `sourceQuoteRef` 두 개의 ref로 사용자가 마지막으로 입력한 모드를 추적.

| ref              | 용도                                       | 설정 시점                                            |
| ---------------- | ------------------------------------------ | ---------------------------------------------------- |
| `inputSourceRef` | `"base"` 또는 `"quote"` — 마지막 입력 모드 | 사용자 타이핑, 슬라이더 조작                         |
| `sourceQuoteRef` | quote 모드에서 입력한 원본 금액 값         | quote 타이핑 시 저장, base 타이핑/슬라이더 시 초기화 |

### 4.2 quote → base 전환

| 조건                                                      | 동작                                |
| --------------------------------------------------------- | ----------------------------------- |
| min lot 미달 (`quoteInput < displayPrice / base_scale_k`) | `amount` 비움 → placeholder 표시    |
| min lot 충족                                              | `amount` 유지 (기존 변환 값 그대로) |

- `quoteInput`은 항상 보존 (다시 quote로 전환 시 복원용)
- `inputSourceRef`, `sourceQuoteRef`는 변경하지 않음

### 4.3 base → quote 전환

| 조건                                             | 동작                                                  |
| ------------------------------------------------ | ----------------------------------------------------- |
| `amount`에 값이 있음 (base에서 입력/수정한 경우) | `syncQuoteInput(amount)` — base 기준으로 quote 재계산 |
| `amount`가 비어있음 (placeholder 상태)           | `quoteInput` 유지 (이전 quote 입력값 복원)            |

---

## 5. displayPrice와 mark price 변경 처리

### 5.1 displayPrice 계산

| 주문 유형 | displayPrice                          | 실시간 업데이트 |
| --------- | ------------------------------------- | --------------- |
| Market    | `storeMarkPrice × slippageMultiplier` | O (WebSocket)   |
| Limit     | 사용자 입력 limit price               | X (수동 입력)   |

슬리피지 배수:

- Long: `1 + maxSlippage / 100` (기본: 1.005)
- Short: `1 - maxSlippage / 100` (기본: 0.995)

### 5.2 displayPrice 변경 시 재계산 (useEffect)

`displayPrice`가 변경되면 useEffect가 입력 소스에 따라 반대쪽 값을 재계산.

| `inputSourceRef`           | 동작                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `"quote"`                  | `amount = sourceQuoteRef / displayPrice` (quote 고정, base 재계산) |
| `"base"` + 현재 quote 모드 | `quoteInput = amount × displayPrice` (base 고정, quote 재계산)     |
| `"base"` + 현재 base 모드  | 변경 없음                                                          |

### 5.3 알려진 이슈: 1프레임 지연

**현상**: mark price 변경 시, 화면 상단의 mark price 표시는 즉시 갱신되지만, 입력창의 base/quote 값은 1프레임 뒤에 갱신됨.

**원인**: mark price 표시는 렌더 중 동기적으로 갱신되지만, 입력값 재계산은 `useEffect` (렌더 후 실행)에서 처리.

```
렌더 1: mark price 갱신 ✅ / 입력값 아직 이전 값 ❌
         ↓ useEffect 실행 → store 업데이트
렌더 2: mark price 갱신 ✅ / 입력값 갱신 ✅
```

**영향**: 수치상 미세한 불일치 (0.01~0.02% 수준). 빠르게 변하는 시장에서 눈에 띌 수 있음.

**해결 방안 (검토 중)**: `useEffect` 대신 `useMemo`로 입력값을 동기적으로 계산하고, useEffect는 store 동기화(슬라이더 등)용으로만 유지. 팀 논의 후 결정 예정.

---

## 6. 슬라이더 연동

슬라이더 조작 시:

- `inputSourceRef = "base"`, `sourceQuoteRef = ""` (base 소스로 전환)
- store의 `handleSliderChange`가 `truncateAmount(computed, baseDecimals)`로 base 수량 계산 (`Math.floor` 절삭)
- quote 모드일 경우 `amount` useEffect가 `syncQuoteInput(amount)` 호출

---

## 7. 버튼 상태 정리

| 우선순위 | 조건                    | `isPlaceable()` | `getButtonText()`           |
| -------- | ----------------------- | --------------- | --------------------------- |
| 1        | `total <= 0`            | `false`         | `"Enter Amount"`            |
| 2        | quote 모드 min lot 미달 | `false`         | `"Enter Amount"`            |
| 3        | 마진 부족               | `false`         | `"Not Enough Margin"`       |
| 4        | 주문 제출 중            | `false`         | `"Submitting..."`           |
| 5        | Reduce Only 방향 오류   | `false`         | —                           |
| 6        | Reduce Only 수량 초과   | `false`         | `"Reduce Only Too Large"`   |
| 7        | Limit인데 가격 미입력   | —               | `"Enter Limit Price"`       |
| 8        | 수량 미입력             | —               | `"Enter Amount"`            |
| 9        | 모두 통과               | `true`          | `"Place {orderType} Order"` |
