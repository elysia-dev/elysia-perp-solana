# 프론트엔드 QA 테스트 시나리오

## 공통 전제

| 항목          | 값       |
| ------------- | -------- |
| 테스트 환경   | Staging  |
| 마켓          | BTC-PERP |
| 담보 토큰     | EL       |
| 최소 입금액   | 1,000 EL |
| 최소 주문액   | $1 USD   |
| 레버리지 범위 | 1x ~ 20x |

## 사전 준비

1. VS Code에서 REST Client 익스텐션 설치 (humao.rest-client)
2. `docs/test-scenarios/qa-test.http` 파일 열기
3. "0. Dev Token 발급" 실행

---

## 1. 예치 (Deposit)

### 1-1. 정상 예치

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

**조건**

- 지갑에 1,000+ EL 보유 (온체인)

**테스트 단계** (프론트엔드)

- [ ] 지갑 연결
- [ ] Deposit 버튼 클릭
- [ ] 1,000 EL 입력
- [ ] Approve 버튼 클릭 → MetaMask 승인
- [ ] Deposit 버튼 클릭 → MetaMask 승인
- [ ] 트랜잭션 확인 대기

**기대 결과**

- 모달이 닫힘
- Available Balance에 1,000 EL$ 반영
- Deposits 탭에 기록 추가

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 1-2. 최소 금액 미만 입력

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

**조건**

- 지갑 연결됨

**테스트 단계** (프론트엔드)

- [ ] Deposit 버튼 클릭
- [ ] 999 EL 입력

**기대 결과**

- "Minimum deposit is 1,000 EL" 에러 메시지 표시
- Deposit 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 1-3. 지갑 잔고 초과 입력

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

**조건**

- 지갑에 1,000 EL 보유

**테스트 단계** (프론트엔드)

- [ ] Deposit 버튼 클릭
- [ ] 2,000 EL 입력 (보유량 초과)

**기대 결과**

- "Insufficient balance" 에러 메시지 표시
- Deposit 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 2. 출금 (Withdrawal)

### 2-1. 정상 출금

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- 오픈 포지션 없음

**테스트 단계** (프론트엔드)

- [ ] Withdraw 버튼 클릭
- [ ] 500 EL$ 입력
- [ ] Withdraw 버튼 클릭
- [ ] 출금 요청 확인

**기대 결과**

- 모달이 닫힘
- Available Balance에서 500 EL$ 차감
- Withdrawals 탭에 Pending 상태로 기록 추가
- 서버에서 출금 트랜잭션 날린 후 완료되면 상태가 Completed로 변경

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 2-2. 잔고 초과 출금

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유

**테스트 단계** (프론트엔드)

- [ ] Withdraw 버튼 클릭
- [ ] 15,000 EL$ 입력 (Available 초과)

**기대 결과**

- "Insufficient available balance" 에러 메시지 표시
- Withdraw 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 3. 주문 (Order)

### 3-1. Limit Long 주문

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- 현재 BTC 가격: $60,000

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Limit 주문 타입 선택
- [ ] 가격: $59,000 입력 (현재가 아래)
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- Open Orders 탭에 주문 표시
- Order Margin이 Available에서 차감
- 주문 상태: Open

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-2. Limit Short 주문

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- 현재 BTC 가격: $60,000

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Short 탭 선택
- [ ] Limit 주문 타입 선택
- [ ] 가격: $61,000 입력 (현재가 위)
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- Open Orders 탭에 주문 표시
- Order Margin이 Available에서 차감
- 주문 상태: Open

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-3. Market Long 주문

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- Orderbook에 매도 호가 존재

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- 즉시 체결
- Positions 탭에 Long 포지션 표시
- Trade History에 체결 기록 추가
- Available Balance에서 마진 차감

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-4. Market Short 주문

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- Orderbook에 매수 호가 존재

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Short 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- 즉시 체결
- Positions 탭에 Short 포지션 표시
- Trade History에 체결 기록 추가
- Available Balance에서 마진 차감

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-5. 주문 취소

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유

**테스트 단계** (프론트엔드)

- [ ] Limit Long 주문 생성 (3-1 참조)
- [ ] Open Orders 탭 선택
- [ ] 취소할 주문의 Cancel 버튼 클릭
- [ ] 취소 확인 (있는 경우)

**기대 결과**

- Open Orders에서 해당 주문 제거
- Order Margin이 Available Balance로 반환
- 주문 상태: Cancelled

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-6. 마진 부족 주문

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance: 10,000 EL$

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 1 BTC 입력 (마진 부족)
- [ ] 레버리지: 10x 설정

**기대 결과**

- "Insufficient margin" 에러 메시지 표시
- Place Order 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-7. 최소 주문액 미만 주문

**사전 준비** (qa-test.http)

- [ ] "전체 상태 리셋" 실행
- [ ] "오라클 업데이트 중지" 실행
- [ ] "오라클 가격 설정" 실행 ($60,000)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.00001 BTC 입력 ($1 미만)
- [ ] 레버리지: 10x 설정

**기대 결과**

- "Minimum order size is $1" 에러 메시지 표시
- Place Order 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 3-8. Reduce Only 크기 초과

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**포지션 준비** (프론트엔드)

- [ ] Market Long 0.02 BTC 체결 (10x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- Long 포지션 보유: 0.02 BTC

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Short 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.03 BTC 입력 (포지션 크기 초과)
- [ ] Reduce Only 체크박스 활성화

**기대 결과**

- "Reduce only order exceeds position size" 에러 메시지 표시
- Place Order 버튼 비활성화

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 4. 포지션 (Position)

### 4-1. 신규 포지션 오픈

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- Available Balance에 10,000 EL$ 보유
- BTC-PERP 포지션 없음

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- Positions 탭에 새 포지션 표시
- Side: Long
- Size: 0.01 BTC
- Entry Price: **$60,100** (Best Ask 체결)
- Margin: ≈ **$59.80** (= $60.10 IM − $0.30 taker fee)
- Liquidation Price: ≈ **$55,620**
- Unrealized PnL: ≈ **−$1.00** (mark $60,000 < entry $60,100)

> 계산: Liq = $60,100 − ($59.80 − $15.00) / 0.01 = $55,620
> (MM = 0.01 × $60,000 × 2.5% = $15)

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 4-2. 포지션 증가 (같은 방향)

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**포지션 준비** (프론트엔드)

- [ ] Market Long 0.02 BTC 체결 (10x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- Long 포지션 보유: 0.02 BTC @ $60,100
- Available Balance에 잔여 잔고 보유

**테스트 단계** (프론트엔드)

- [ ] 주문 패널에서 Long 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.01 BTC 입력
- [ ] 레버리지: 10x 설정
- [ ] Place Order 버튼 클릭

**기대 결과**

- Positions 탭에서 포지션 업데이트
- Size: **0.03 BTC**
- Entry Price: **$60,100** (동일가 체결 → 가중평균 불변)
- Total Margin: ≈ **$179.40**
- Liquidation Price: ≈ **$55,620**
- Unrealized PnL: ≈ **−$3.00**

> 두 주문 모두 Best Ask $60,100에서 체결 (0.5 BTC depth 내).
> 동일 가격 Increase이므로 Entry Price는 변동 없음.

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 4-3. 포지션 부분 종료

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**포지션 준비** (프론트엔드)

- [ ] Market Long 0.02 BTC 체결 (10x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- Long 포지션 보유: 0.02 BTC @ $60,100

**테스트 단계** (프론트엔드)

- [ ] Positions 탭에서 해당 포지션 확인
- [ ] 주문 패널에서 Short 탭 선택
- [ ] Market 주문 타입 선택
- [ ] 수량: 0.01 BTC 입력 (절반만)
- [ ] Place Order 버튼 클릭

**기대 결과**

- Positions 탭에서 포지션 업데이트
- Size: **0.01 BTC**
- Entry Price: **$60,100** (Decrease에서 불변)
- Realized PnL: **−$2.00** (= ($59,900 − $60,100) × 0.01)
- Remaining Margin: ≈ **$59.80**
- Liquidation Price: ≈ **$55,620**
- Trade History에 체결 기록

> 종료 체결: Best Bid $59,900. Decrease 시 entry_price는 변하지 않음.

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 4-4. 포지션 전체 종료

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**포지션 준비** (프론트엔드)

- [ ] Market Long 0.02 BTC 체결 (10x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- Long 포지션 보유: 0.02 BTC @ $60,100

**테스트 단계** (프론트엔드)

- [ ] Positions 탭에서 해당 포지션 확인
- [ ] Close 버튼 클릭
- [ ] 수량 확인 (전체)
- [ ] Confirm Close 버튼 클릭

**기대 결과**

- Positions 탭에서 해당 포지션 제거
- Realized PnL: **−$4.00** (= ($59,900 − $60,100) × 0.02)
- Margin 반환: **$119.60** (전액)
- Available Balance 증가: ≈ **$115.00** (margin − fee + PnL)
- Trade History에 체결 기록

> 종료 체결: Best Bid $59,900. Fee: 0.02 × $59,900 × 0.05% = $0.60

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 5. 청산 (Liquidation)

### 5-1. 청산 발생 (가격 변동)

**사전 준비** (qa-test.http)

- [ ] `npm run seed:liquidation` 실행 (리셋 + 오라클 $60,000 + MM봇 Ask+저가Bid)

**포지션 준비** (프론트엔드)

- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)
- [ ] Market Long 0.1 BTC 체결 (20x)
- [ ] Positions 탭에서 포지션 및 Liq Price 확인 (≈ $58,625)

**조건**

- 테스트 계정: Long 0.1 BTC @ $60,100 (20x), Liq Price ≈ $58,625

> 계산: Margin ≈ $297.50, MM = 0.1×$60,000×2.5% = $150
> Liq = $60,100 − ($297.50 − $150) / 0.1 = $58,625

**테스트 단계**

- [ ] (qa-test.http) "오라클 가격 설정" 실행 (price: 56000)
- [ ] 프론트에서 청산 처리 확인 (수 초 대기)

**기대 결과**

- Positions 탭에서 본인 포지션 제거
- Liquidation History에 기록 추가

**테스트 후 정리** (qa-test.http)

- [ ] "오라클 업데이트 재개" 실행
- [ ] "전체 상태 리셋" 실행

---

### 5-2. Limit IOC 청산 체결

> 5-1과 동일한 절차. 청산 주문이 Orderbook의 Bid에서 체결되는지 확인하는 테스트.

**사전 준비** (qa-test.http)

- [ ] `npm run seed:liquidation` 실행 (리셋 + 오라클 $60,000 + MM봇 Ask+저가Bid)

**포지션 준비** (프론트엔드)

- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)
- [ ] Market Long 0.1 BTC 체결 (20x)
- [ ] Orderbook에 저가 Bid 호가 존재 확인

**조건**

- 테스트 계정: Long 0.1 BTC (20x)
- Orderbook에 Bid 호가 존재 (청산 시 IOC 체결용)

**테스트 단계**

- [ ] (qa-test.http) "오라클 가격 설정" 실행 (price: 56000)
- [ ] 청산 처리 대기

**기대 결과**

- 청산 주문이 Orderbook Bid에서 체결
- 포지션 완전 청산
- 청산 수수료 차감
- Trade History에 청산 체결 기록

**테스트 후 정리** (qa-test.http)

- [ ] "오라클 업데이트 재개" 실행
- [ ] "전체 상태 리셋" 실행

---

### 5-3. Insurance Fund 인수

**사전 준비** (qa-test.http)

- [ ] `npm run seed:insurance` 실행 (리셋 + 오라클 $60,000 + MM봇 Ask만 + IF 10,000 EL$)

**포지션 준비** (프론트엔드)

- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)
- [ ] Market Long 0.1 BTC 체결 (20x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- 테스트 계정: Long 0.1 BTC (20x)
- Orderbook에 Bid 없음 (IOC 실패)
- Insurance Fund에 10,000 EL$ 존재

**테스트 단계**

- [ ] (qa-test.http) "Insurance Fund 잔액 확인" 실행
- [ ] (qa-test.http) "오라클 가격 설정" 실행 (price: 56000)
- [ ] 청산 처리 대기
- [ ] (qa-test.http) "Insurance Fund 포지션 확인" 실행

**기대 결과**

- 본인 포지션 청산
- Insurance Fund에 포지션 이관
- Insurance Fund 포지션에서 해당 포지션 확인

**테스트 후 정리** (qa-test.http)

- [ ] "오라클 업데이트 재개" 실행
- [ ] "전체 상태 리셋" 실행

---

### 5-4. ADL 실행

**사전 준비** (qa-test.http)

- [ ] `npm run seed:adl` 실행 (리셋 + 오라클 $60,000 + MM봇 Ask + ADL counter Short + IF=0)

**포지션 준비** (프론트엔드)

- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)
- [ ] Market Long 0.5 BTC 체결 (20x)
- [ ] Positions 탭에서 포지션 확인

**조건**

- 테스트 계정: Long 0.5 BTC (20x)
- Orderbook Bid 없음 (ADL counter의 Short 체결로 소진됨)
- Insurance Fund: 0 (부족)
- ADL 대상 (preset이 생성): Short 0.5 BTC (5x)

**테스트 단계**

- [ ] (qa-test.http) "Insurance Fund 잔액 확인" 실행 (0 확인)
- [ ] (qa-test.http) "오라클 가격 설정" 실행 (price: 56000)
- [ ] ADL 처리 대기

**기대 결과**

- 본인 포지션 청산 (ADL)
- ADL 대상 계정의 Short 포지션 강제 축소
- Trade History에 ADL 기록

**테스트 후 정리** (qa-test.http)

- [ ] "오라클 업데이트 재개" 실행
- [ ] "전체 상태 리셋" 실행

---

## 6. 펀딩비 (Funding Fee)

### 6. 펀딩비 테스트 개요

> **중요**: 펀딩 라운드(기본 ~1시간) 대기가 필요하므로 **QA 마지막에 실행**합니다.
> 다른 테스트의 리셋이 상태를 초기화하므로, 반드시 다른 테스트를 모두 마친 뒤 실행합니다.
> 테스터 2명이 동시에 포지션을 오픈하고, 1시간 후 각각 **종료(6-1)**와 **증가(6-2)**로 정산을 확인합니다.
>
> 펀딩 정산은 별도 API가 아닌, **포지션 종료/증가 시 자동으로 발생**합니다 (lazy settlement).
> 이것이 프로덕션과 동일한 정산 경로입니다.

**공통 사전 준비**

- [ ] `npm run seed:funding` 실행 (리셋 + 오라클 중지 + mark/index 분리 설정 + Counter Short + MM봇 오더북)

> seed:funding은 `POST /dev/oracle/prices`로 mark=$60,100 / index=$60,000을 설정합니다.
> premium = ($60,100 − $60,000) / $60,000 ≈ 0.167% → 펀딩 라운드 시 의미 있는 PnL 발생.

**공통 포지션 준비** (프론트엔드, 테스터 A + B 각각)

- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)
- [ ] Market Long 0.01 BTC 체결 (10x)
- [ ] Positions 탭에서 포지션 및 Funding PnL = $0 확인
- [ ] **→ ≥1시간 대기** (다른 작업 진행)

---

### 6-1. 펀딩비 정산 — 포지션 종료 (테스터 A)

> ≥1시간 경과 후 실행. 포지션 Close 시 lazy settlement가 발동하여 Funding PnL이 정산되는지 확인.

**조건**

- Long 0.01 BTC 포지션 보유 (≥1시간 경과)
- Funding PnL 필드에 음수 값 표시 중 (Long이 지불)

**테스트 단계** (프론트엔드)

- [ ] Positions 탭에서 Funding PnL 확인 및 기록 (음수)
- [ ] 현재 Margin 값 기록
- [ ] 포지션 전체 Close 실행
- [ ] Close 후 Realized PnL 확인 (Funding 반영 여부)
- [ ] Trade History에 체결 기록 확인

**기대 결과**

- Close 전: Funding PnL 음수 표시 (Long이 지불)
- Close 실행 시: 누적 Funding이 margin에서 차감된 뒤 정산
- Close 후: 포지션 제거, 반환된 margin에 Funding 차감분 반영

---

### 6-2. 펀딩비 정산 — 포지션 증가 (테스터 B)

> ≥1시간 경과 후 실행. 포지션 Increase 시 lazy settlement가 발동하여 Funding PnL이 정산되는지 확인.

**조건**

- Long 0.01 BTC 포지션 보유 (≥1시간 경과)
- Funding PnL 필드에 음수 값 표시 중 (Long이 지불)

**테스트 단계** (프론트엔드)

- [ ] Positions 탭에서 Funding PnL 확인 및 기록 (음수)
- [ ] 현재 Margin 값 기록
- [ ] Market Long 0.01 BTC 추가 체결 (Increase)
- [ ] Increase 후 Funding PnL 확인 (**0으로 리셋**)
- [ ] Increase 후 Margin 확인 (기존 Funding 차감 + 새 마진 추가)

**기대 결과**

- Increase 전: Funding PnL 음수 표시
- Increase 실행 시: 기존 Funding이 margin에서 차감 (lazy settlement) → 새 주문 마진 추가
- Increase 후: Funding PnL = 0 (prefix_sum 리셋), Margin = 기존margin − funding + 새마진

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 7. 차트 (Chart)

### 7-1. 캔들스틱 로딩

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- 트레이딩 페이지 접속

**테스트 단계** (프론트엔드)

- [ ] BTC-PERP 마켓 선택
- [ ] 차트 로딩 대기
- [ ] 1분봉 선택
- [ ] 5분봉 선택
- [ ] 15분봉 선택
- [ ] 1시간봉 선택
- [ ] 4시간봉 선택
- [ ] 1일봉 선택

**기대 결과**

- 각 시간대별 캔들스틱 정상 렌더링
- 과거 데이터 로딩 (스크롤 시)
- 현재가 라인 표시

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

### 7-2. 실시간 업데이트

**사전 준비** (qa-test.http)

- [ ] `npm run seed:orderbook` 실행 (리셋 + 오라클 $60,000 + MM봇 오더북)
- [ ] 프론트에서 예치 (Approve → Deposit → tx 확인)

**조건**

- 차트 로딩 완료
- 거래가 발생하는 환경

**테스트 단계** (프론트엔드)

- [ ] 1분봉 차트 선택
- [ ] 현재 캔들 확인
- [ ] 거래 발생 (직접 주문 또는 다른 계정에서)
- [ ] 차트 업데이트 확인

**기대 결과**

- 거래 발생 시 현재 캔들 실시간 업데이트
- 새 캔들 시작 시 자동 추가
- 가격 축 자동 조정

**테스트 후 정리** (qa-test.http)

- [ ] "전체 상태 리셋" 실행

---

## 부록 A: 서버팀 요청 API

### A-1. 이미 구현된 API (즉시 사용 가능)

| 엔드포인트                      | 메서드 | 용도                                                                | 필요 테스트                  |
| ------------------------------- | ------ | ------------------------------------------------------------------- | ---------------------------- |
| `/dev/oracle/price`             | POST   | 오라클 가격 수동 설정                                               | 전체 (모든 테스트 사전 준비) |
| `/dev/oracle/pause`             | POST   | Binance 업데이트 중지                                               | 전체 (모든 테스트 사전 준비) |
| `/dev/oracle/resume`            | POST   | Binance 업데이트 재개                                               | 5-1 ~ 5-4 (테스트 후 정리)   |
| `/dev/funding/settle-now`       | POST   | 펀딩비 즉시 정산                                                    | 6-2 (펀딩비)                 |
| `/dev/insurance-fund`           | GET    | Insurance Fund 잔액 조회                                            | 5-3, 5-4 (청산)              |
| `/dev/insurance-fund/deposit`   | POST   | Insurance Fund 입금                                                 | 5-3 (청산)                   |
| `/dev/insurance-fund/positions` | GET    | Insurance Fund 포지션 조회                                          | 5-3, 5-4 (청산)              |
| `/dev/reset`                    | POST   | 전체 상태 리셋                                                      | 전체 (테스트 시작 전)        |
| `/dev/seed`                     | POST   | 테스트 데이터 시딩 (현재: 기본 기능만, 프리셋 확장 필요 → A-2 참조) | 전체                         |
| `/dev/account/deposit`          | POST   | 모의 입금 (온체인 없이)                                             | 필요 시                      |
| `/dev/state`                    | GET    | 현재 상태 조회                                                      | 전체 (디버깅)                |
| `/dev/consistency-check`        | GET    | 상태 일관성 검증                                                    | 전체 (디버깅)                |

### A-2. 추가 개발 요청 API

#### 펀딩비 즉시 정산 API — ✅ 구현 완료

```
POST /dev/funding/settle-now
Body: { "market_id": 100 }  // 선택사항, 없으면 전체 마켓
```

- 용도: 누적된 Funding PnL을 position.margin에 즉시 정산 (트레이드 없이 settlement 강제 실행)
- QA 테스트에서는 **미사용** — 포지션 종료/증가 시 lazy settlement로 자연 정산을 테스트
- 디버깅/개발용으로 유지

#### 오라클 가격 분리 설정 API — ⏳ 요청 중

```
POST /dev/oracle/prices
Body: { "symbol": "BTC-PERP", "mark_price": 60100, "index_price": 60000 }
```

- 용도: mark_price와 index_price를 **독립적으로** 설정하여 펀딩 premium 생성
- 필요 테스트: 6-1, 6-2 (펀딩비)
- **배경**: 기존 `POST /dev/oracle/price`는 mark/index/impact를 모두 동일한 값으로 설정하므로 premium이 항상 0이 됨. 펀딩비 테스트에는 mark ≠ index가 필요.
- **구현 참고**: `oracle/service.rs:390` — `set_prices_for_testing(symbol, mark_price, index_price)` 함수가 **이미 구현되어 있음**. API 핸들러만 추가하면 됨.
- **구현량**: handler 1개 + route 1줄 (기존 `set_price_for_testing` 핸들러 복사+수정)

<details>
<summary>서버 구현 참고 (기존 코드)</summary>

```rust
// oracle/service.rs:388-411 — 이미 구현된 함수
/// Set mark_price and index_price independently (for testing dynamic funding rate).
/// Impact prices default to mark_price. Accepts f64 USD.
pub fn set_prices_for_testing(&self, symbol: &str, mark_price: f64, index_price: f64) {
    // ... impact_bid = impact_ask = mark_price, index_price = 별도 설정
}

// 핸들러 추가 예시 (oracle/mod.rs에 추가):
#[derive(Deserialize)]
pub struct SetPricesRequest {
    pub symbol: String,
    pub mark_price: f64,
    pub index_price: f64,
}

pub async fn set_prices_for_testing(
    oracle_service: web::Data<Arc<OracleService>>,
    req: web::Json<SetPricesRequest>,
) -> impl Responder {
    oracle_service.set_prices_for_testing(&req.symbol, req.mark_price, req.index_price);
    // ...
}

// app.rs에 라우트 추가:
cfg.route("/dev/oracle/prices", web::post().to(set_prices_for_testing));
```

</details>

#### 시드 프리셋 스크립트 — ✅ 기존 API로 구현 완료

서버 프리셋 대신 기존 API(`/dev/token`, `/dev/account/deposit`, `/perp/order` 등)를 조합한 Node.js 스크립트로 구현.

```bash
npm run seed:orderbook      # MM봇 양방향 오더북
npm run seed:liquidation    # MM봇 Ask + 저가 Bid
npm run seed:insurance      # MM봇 Ask만 + IF 입금
npm run seed:adl            # MM봇 + ADL counter Short + IF=0
npm run seed:funding        # Counter Short + MM봇 오더북
```

- **용도**: 테스트별 초기 상태 자동 세팅 (리셋 + 오라클 중지 + 가격 설정 + MM봇 생성)
- **서버 수정 불필요**: 기존 API(`/dev/token`, `/dev/account/deposit`, `/perp/order` 등)만 사용
- **상세 명세**: 부록 B 참조, 스크립트 코드: `docs/test-scenarios/scripts/seed.js`

---

## 부록 B: 시드 프리셋 상세 명세

### B-1. 테스트별 필요 데이터 매핑

> **설계 원칙**: Preset = 환경(카운터파티) 세팅만. Test user 잔고/주문/포지션 = QA 수행자가 직접.

| 테스트             | Seed 프리셋   | 별도 API 호출              | QA 수행자 액션                                            |
| ------------------ | ------------- | -------------------------- | --------------------------------------------------------- |
| 1-1 ~ 1-3 (예치)   | 없음          |                            | 온체인 예치                                               |
| 2-1 ~ 2-2 (출금)   | 없음          | 오라클 중지+설정           | 예치 → 출금                                               |
| 3-1 ~ 3-2 (Limit)  | 없음          | 오라클 중지+설정           | 예치 → Limit 주문                                         |
| 3-3 ~ 3-4 (Market) | `orderbook`   | 오라클 중지+설정           | 예치 → Market 주문                                        |
| 3-5 (취소)         | 없음          | 오라클 중지+설정           | 예치 → Limit 주문 → 취소                                  |
| 3-6 ~ 3-7 (에러)   | 없음          | 오라클 중지+설정           | 예치 → 에러 확인                                          |
| 3-8 (Reduce Only)  | `orderbook`   | 오라클 중지+설정           | 예치 → Market Long → Reduce Only                          |
| 4-1 (신규 오픈)    | `orderbook`   | 오라클 중지+설정           | 예치 → Market Long                                        |
| 4-2 ~ 4-4 (포지션) | `orderbook`   | 오라클 중지+설정           | 예치 → Market Long → 증가/감소/종료                       |
| 5-1 ~ 5-2 (청산)   | `liquidation` | 오라클 중지+설정           | 예치 → Market Long 20x → 오라클 $56,000 → **본인 청산**   |
| 5-3 (Insurance)    | `insurance`   | 오라클 중지+설정, IF 입금  | 예치 → Market Long 20x → 오라클 $56,000 → **IF 인수**     |
| 5-4 (ADL)          | `adl`         | 오라클 중지+설정           | 예치 → Market Long 20x → 오라클 $56,000 → **ADL**         |
| 6-1 (펀딩+종료)    | `funding`     | oracle/prices (mark≠index) | 예치 → Market Long → (≥1시간 대기) → Close로 정산 확인    |
| 6-2 (펀딩+증가)    | `funding`     | oracle/prices (mark≠index) | 예치 → Market Long → (≥1시간 대기) → Increase로 정산 확인 |
| 7-1 ~ 7-2 (차트)   | `orderbook`   | 오라클 중지+설정           | 예치 → 거래 발생                                          |

### B-2. 프리셋별 상세 데이터

> **설계 원칙**: Preset은 카운터파티/환경만 세팅한다. Test user의 잔고/주문/포지션은 QA 수행자가 직접 수행.

#### (Seed 없음) — 오라클 중지 + 가격 설정만

- `dev/oracle/pause` + `dev/oracle/price` ($60,000) 실행
- 유저/오더북/포지션: 없음
- QA 수행자: 프론트에서 Sepolia 예치 후 테스트
- 사용 테스트: 2-1, 2-2, 3-1, 3-2, 3-5, 3-6, 3-7

---

#### orderbook - MM봇 오더북

- Oracle BTC-PERP: $60,000
- MM Bot 2명: 각 500,000 EL$ deposit, 양방향 호가 5단계

| Side        | Price   | Size    | User |
| ----------- | ------- | ------- | ---- |
| Ask (Short) | $60,100 | 0.5 BTC | MM1  |
| Ask (Short) | $60,200 | 1.0 BTC | MM2  |
| Ask (Short) | $60,300 | 1.5 BTC | MM1  |
| Ask (Short) | $60,500 | 2.0 BTC | MM2  |
| Ask (Short) | $61,000 | 3.0 BTC | MM1  |
| Bid (Long)  | $59,900 | 0.5 BTC | MM2  |
| Bid (Long)  | $59,800 | 1.0 BTC | MM1  |
| Bid (Long)  | $59,500 | 1.5 BTC | MM2  |
| Bid (Long)  | $59,000 | 2.0 BTC | MM1  |
| Bid (Long)  | $58,500 | 3.0 BTC | MM2  |

- QA 수행자: 프론트에서 Sepolia 예치 → 주문/포지션 직접 수행
- 사용 테스트: 3-3, 3-4, 3-8, 4-1~4-4, 7-1, 7-2

---

#### liquidation - 청산 테스트

> 테스트 유저가 직접 Long 포지션을 열고 청산당하는 시나리오.

- MM Bot: Ask 호가 (테스트 유저 Long 오픈용) + 저가 Bid 호가 (청산 IOC 체결용)

| Side        | Price   | Size    | 용도                         |
| ----------- | ------- | ------- | ---------------------------- |
| Ask (Short) | $60,100 | 0.5 BTC | 테스트 유저 Market Long 체결 |
| Ask (Short) | $60,200 | 1.0 BTC |                              |
| Bid (Long)  | $56,500 | 0.5 BTC | 청산 IOC 체결                |
| Bid (Long)  | $56,000 | 0.5 BTC |                              |
| Bid (Long)  | $55,000 | 1.0 BTC |                              |

- Insurance Fund: 없음
- 사용 테스트: 5-1, 5-2

---

#### insurance - Insurance Fund 인수 테스트

> 테스트 유저가 직접 Long 포지션을 열고, Bid 없이 청산 → IF 인수.
> IF 입금은 preset이 아닌 `/dev/insurance-fund/deposit` 별도 호출.

- MM Bot: Ask 호가만 (테스트 유저 Long 오픈용). **Bid 없음** (IOC 실패 → IF 인수)

| Side        | Price   | Size    |
| ----------- | ------- | ------- |
| Ask (Short) | $60,100 | 0.5 BTC |
| Ask (Short) | $60,200 | 1.0 BTC |

- Insurance Fund: **별도 API로 입금** (`/dev/insurance-fund/deposit`)
- 사용 테스트: 5-3

---

#### adl - ADL 테스트

> 테스트 유저 Long + ADL counter Short. Bid 없음 + IF = 0 → ADL 발동.

- MM Bot: Ask 호가 (테스트 유저 Long용) + Bid 호가 (ADL counter Short 체결용)
- ADL counter: preset에서 실제 API로 입금 → Market Short → Bid에서 체결 → Short 포지션 자연 생성
- Bid는 ADL counter의 Short 체결로 소진 → 이후 Bid 없음

| Side        | Price   | Size    | 용도                            |
| ----------- | ------- | ------- | ------------------------------- |
| Ask (Short) | $60,100 | 1.0 BTC | 테스트 유저 Market Long 체결    |
| Ask (Short) | $60,200 | 1.0 BTC |                                 |
| Bid (Long)  | $59,900 | 0.5 BTC | ADL counter Market Short로 소진 |

- Insurance Fund: **0 EL$** (고갈)
- ADL counter 결과: Short 0.5 BTC @ ~$59,900 (5x)
  - 오라클 $56,000 이동 시 unrealized PnL = +$1,950
- 사용 테스트: 5-4

---

#### funding - 펀딩비 테스트

- Counter: Short 0.005 BTC @ $60,000 (10x) — OI 불균형 환경 제공
- MM Bot 2명: `orderbook` preset과 동일한 양방향 호가 (test user가 Market Long 체결용)
- QA 수행자 (2명): 각자 예치 → Market Long → (≥1시간 대기) → A: Close로 정산 확인 / B: Increase로 정산 확인
- 사용 테스트: 6-1, 6-2

---

### B-3. 프리셋 요약표

> Preset은 카운터파티/환경만 세팅. Test user 관련 데이터는 포함하지 않음.

| 프리셋        | Seed가 세팅하는 것                   | 오더북              | 별도 API 필요              | 사용 테스트              |
| ------------- | ------------------------------------ | ------------------- | -------------------------- | ------------------------ |
| (없음)        | -                                    | -                   | 오라클 중지+설정           | 2-1~2, 3-1~2, 3-5~7      |
| `orderbook`   | MM봇 2명                             | 양방향 5단계        | 오라클 중지+설정           | 3-3~4, 3-8, 4-1~4, 7-1~2 |
| `liquidation` | MM봇 (Ask + 저가 Bid)                | Ask 2개 + Bid 3개   | 오라클 중지+설정           | 5-1~2                    |
| `insurance`   | MM봇 (Ask만)                         | Ask 2개, Bid 없음   | 오라클 중지+설정, IF 입금  | 5-3                      |
| `adl`         | MM봇 (Ask + Bid) + ADL counter Short | Ask 2개, Bid 소진됨 | 오라클 중지+설정           | 5-4                      |
| `funding`     | Counter Short + MM봇 2명             | 양방향 5단계        | oracle/prices (mark≠index) | 6-1~2                    |

---

## 부록 C: 시나리오별 실행 순서

> **참고**: `npm run seed:*` 스크립트는 리셋 + 오라클 중지 + 가격 설정($60,000)을 자동 포함합니다.
> Seed가 필요 없는 테스트(1-x, 2-x, 3-1~2, 3-5~7)는 qa-test.http에서 수동으로 리셋 + 오라클 설정을 실행합니다.

| 시나리오                        | 실행 순서                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-1 ~ 1-3 (예치)                | Token → 리셋                                                                                                                                             |
| 2-1 ~ 2-2 (출금)                | Token → 리셋 → oracle pause → oracle $60K → 예치                                                                                                         |
| 3-1 ~ 3-2 (Limit)               | Token → 리셋 → oracle pause → oracle $60K → 예치                                                                                                         |
| 3-3 ~ 3-4 (Market)              | Token → **`npm run seed:orderbook`** → 예치                                                                                                              |
| 3-5 (취소)                      | Token → 리셋 → oracle pause → oracle $60K → 예치                                                                                                         |
| 3-6 ~ 3-7 (에러)                | Token → 리셋 → oracle pause → oracle $60K → 예치                                                                                                         |
| 3-8 (Reduce Only)               | Token → **`npm run seed:orderbook`** → 예치 → Market Long 0.02 BTC                                                                                       |
| 4-1 (신규 오픈)                 | Token → **`npm run seed:orderbook`** → 예치                                                                                                              |
| 4-2 ~ 4-4 (포지션)              | Token → **`npm run seed:orderbook`** → 예치 → Market Long 0.02 BTC                                                                                       |
| 5-1 ~ 5-2 (청산)                | Token → **`npm run seed:liquidation`** → 예치 → Market Long 0.1 BTC (20x) → oracle $56K → (확인) → oracle resume → 리셋                                  |
| 5-3 (Insurance)                 | Token → **`npm run seed:insurance`** → 예치 → Market Long 0.1 BTC (20x) → oracle $56K → (확인) → oracle resume → 리셋                                    |
| 5-4 (ADL)                       | Token → **`npm run seed:adl`** → 예치 → Market Long 0.5 BTC (20x) → oracle $56K → (확인) → oracle resume → 리셋                                          |
| 7-1 ~ 7-2 (차트)                | Token → **`npm run seed:orderbook`** → 예치                                                                                                              |
| 6-1~6-2 (펀딩비, **QA 마지막**) | Token (A+B) → **`npm run seed:funding`** → 각자 예치 → 각자 Market Long 0.01 BTC → (≥1시간 대기) → A: Close로 정산 확인 / B: Increase로 정산 확인 → 리셋 |

---

## 테스트 케이스 요약

| 카테고리                | 케이스 수 |
| ----------------------- | --------- |
| 1. 예치 (Deposit)       | 3         |
| 2. 출금 (Withdrawal)    | 2         |
| 3. 주문 (Order)         | 8         |
| 4. 포지션 (Position)    | 4         |
| 5. 청산 (Liquidation)   | 4         |
| 6. 펀딩비 (Funding Fee) | 2         |
| 7. 차트 (Chart)         | 2         |
| **총계**                | **25**    |
