/**
 * 지갑 주소 뒤 4자리를 10진수 user_id로 변환
 * 예: 0x...5678 → 22136, 0x...abcd → 43981
 */
export function addressToUserId(address: string): number {
  const last4 = address.slice(-4)
  return parseInt(last4, 16)
}
