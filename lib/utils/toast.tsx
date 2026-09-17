import { toast } from "sonner"

// Toast card design: Figma 2026_ELYSIA node 2918-2526 (order-toast light
// surface) — #1e1e1e surface, #333 border, deep shadow, mono values,
// tinted side/status pills.

type Side = "Long" | "Short"
// "Liquidation" flows through from order-history records (engine-written
// close orders); cancel toasts never fire for them at runtime, but the
// type must admit the full record shape.
type OrderType = "Limit" | "Market" | "Liquidation"

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 8,
  })
}

// --- Shared styles (design tokens from the Figma card) ---

const SHELL =
  "relative w-[264px] rounded-md border border-[#333] bg-[#1e1e1e] shadow-[0px_8px_24px_0px_rgba(0,0,0,0.55)]"
const HEADER =
  "flex items-center justify-between border-b border-[#2d2d2d] px-4 py-3.5"
const LABEL = "text-xs text-[#8f8f8f]"
const VALUE = "font-mono text-xs font-medium text-[#eee]"

// --- Shared components ---

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute -top-2 -right-2 flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-[#444] bg-[#2d2d2d]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        className="size-3 text-foreground"
      >
        <line
          x1="200"
          y1="56"
          x2="56"
          y2="200"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="16"
        />
        <line
          x1="200"
          y1="200"
          x2="56"
          y2="56"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="16"
        />
      </svg>
    </button>
  )
}

function SideBadge({ side }: { side: Side }) {
  const isLong = side === "Long"
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-[3px] text-xs font-medium leading-none ${
        isLong
          ? "border-[#0dbb92]/50 bg-[#0dbb92]/16 text-[#0dbb92]"
          : "border-[#e85a5a]/50 bg-[#e85a5a]/16 text-[#e85a5a]"
      }`}
    >
      {side.toUpperCase()}
    </span>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 25" fill="none" className="size-3.5 text-[#0dbb92]">
      <path
        d="M0 12.5C0 5.87258 5.37258 0.5 12 0.5C18.6274 0.5 24 5.87258 24 12.5C24 19.1274 18.6274 24.5 12 24.5C5.37258 24.5 0 19.1274 0 12.5Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path
        d="M11 17.5L11.7071 18.2071C11.5196 18.3946 11.2652 18.5 11 18.5C10.7348 18.5 10.4804 18.3946 10.2929 18.2071L11 17.5ZM10.2929 16.7929L18.2929 8.79289L19.7071 10.2071L11.7071 18.2071L10.2929 16.7929ZM6.70711 11.7929L11.7071 16.7929L10.2929 18.2071L5.29289 13.2071L6.70711 11.7929Z"
        fill="currentColor"
      />
    </svg>
  )
}

function StatusPill({
  tone,
  children,
  withCheck = false,
}: {
  tone: "success" | "error" | "neutral"
  children: string
  withCheck?: boolean
}) {
  const toneClass =
    tone === "success"
      ? "bg-[#0dbb92]/14 text-[#0dbb92]"
      : tone === "error"
        ? "bg-[#e85a5a]/14 text-[#e85a5a]"
        : "bg-white/10 text-[#eee]"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${toneClass}`}
    >
      {children}
      {withCheck && <CheckIcon />}
    </span>
  )
}

function StatusBadge({ status }: { status: "success" | "error" }) {
  return status === "success" ? (
    <StatusPill tone="success" withCheck>
      Open
    </StatusPill>
  ) : (
    <StatusPill tone="error">Failed</StatusPill>
  )
}

// --- Order toast card ---

interface OrderToastParams {
  market: string
  side: Side
  orderType: OrderType
  size: string
  baseCurrency: string
  price: number
  /**
   * Market orders fill at orderbook prices, but we only know the user-submitted
   * slippage ceiling at toast time — the actual VWAP fill isn't on the order
   * response. When `approximate` is true the price is rendered with a "≈"
   * prefix so the user understands it's not the exact fill price.
   */
  approximate?: boolean
  /**
   * Backend failure reason (e.g. "insufficient liquidity", "below min order
   * size"). Only meaningful on the error toast; rendered as a "Reason" row so
   * the user sees WHY the order was rejected instead of a bare "Failed".
   */
  reason?: string
}

function OrderToastCard({
  params,
  status,
  onClose,
}: {
  params: OrderToastParams
  status: "success" | "error"
  onClose: () => void
}) {
  const { side, orderType, size, baseCurrency, price, approximate, reason } =
    params
  return (
    <div className={SHELL}>
      <CloseButton onClick={onClose} />

      {/* Header */}
      <div className={HEADER}>
        <span className={LABEL}>{orderType} Order</span>
        <div className="flex items-center gap-2">
          <span className={VALUE}>{baseCurrency}</span>
          <SideBadge side={side} />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col pb-1">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className={LABEL}>Status</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className={LABEL}>Size</span>
          <span className={VALUE}>{size}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className={LABEL}>Price</span>
          <span className={VALUE}>
            {approximate ? "≈ " : ""}
            {formatPrice(price)}
          </span>
        </div>
        {status === "error" && reason ? (
          <div className="flex items-start justify-between gap-2 px-4 py-2.5">
            <span className={`shrink-0 ${LABEL}`}>Reason</span>
            <span className="text-right text-xs text-[#e85a5a]">{reason}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// --- Trading-specific toasts ---

const TOAST_DURATION = 15000

function orderSubmitted(params: OrderToastParams) {
  toast.custom(
    (id) => (
      <OrderToastCard
        params={params}
        status="success"
        onClose={() => toast.dismiss(id)}
      />
    ),
    { duration: TOAST_DURATION }
  )
}

function orderFailed(params: OrderToastParams) {
  toast.custom(
    (id) => (
      <OrderToastCard
        params={params}
        status="error"
        onClose={() => toast.dismiss(id)}
      />
    ),
    { duration: TOAST_DURATION }
  )
}

interface CancelToastParams {
  market: string
  side: Side
  orderType: OrderType
  size: string
  baseCurrency: string
  price: number
}

function orderCancelled(params: CancelToastParams) {
  const { side, orderType, size, baseCurrency, price } = params
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />

        <div className={HEADER}>
          <span className={LABEL}>{orderType} Order</span>
          <div className="flex items-center gap-2">
            <span className={VALUE}>{baseCurrency}</span>
            <SideBadge side={side} />
          </div>
        </div>

        <div className="flex flex-col pb-1">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className={LABEL}>Status</span>
            <StatusPill tone="neutral">Cancelled</StatusPill>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className={LABEL}>Size</span>
            <span className={VALUE}>{size}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className={LABEL}>Price</span>
            <span className={VALUE}>{formatPrice(price)}</span>
          </div>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

function depositSuccess() {
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />

        <div className={HEADER}>
          <span className={LABEL}>Deposit</span>
          <StatusPill tone="success" withCheck>
            Submitted
          </StatusPill>
        </div>

        <div className="px-4 py-3">
          <span className={LABEL}>
            Deposit submitted. Balance will be credited after confirmation.
          </span>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

function depositFailed(message?: string) {
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />

        <div className={HEADER}>
          <span className={LABEL}>Deposit</span>
          <StatusBadge status="error" />
        </div>

        <div className="px-4 py-3">
          <span className={LABEL}>{message || "Something went wrong"}</span>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

function positionClosed(params: {
  market: string
  side: Side
  size: string
  baseCurrency: string
}) {
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />
        <div className={HEADER}>
          <span className={LABEL}>Position Closed</span>
          <div className="flex items-center gap-2">
            <span className={VALUE}>{params.baseCurrency}</span>
            <SideBadge side={params.side} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className={LABEL}>Size</span>
          <span className={VALUE}>{params.size}</span>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

function withdrawSuccess(amount: string, symbol: string) {
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />

        <div className={HEADER}>
          <span className={LABEL}>Withdraw</span>
          <StatusPill tone="success" withCheck>
            Requested
          </StatusPill>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className={LABEL}>Amount</span>
            <span className={VALUE}>
              {amount} {symbol}
            </span>
          </div>
          <span className={LABEL}>
            Tokens will be sent to your wallet shortly.
          </span>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

function withdrawFailed(message?: string) {
  toast.custom(
    (id) => (
      <div className={SHELL}>
        <CloseButton onClick={() => toast.dismiss(id)} />

        <div className={HEADER}>
          <span className={LABEL}>Withdraw</span>
          <StatusBadge status="error" />
        </div>

        <div className="px-4 py-3">
          <span className={LABEL}>{message || "Something went wrong"}</span>
        </div>
      </div>
    ),
    { duration: TOAST_DURATION }
  )
}

// --- Generic toasts ---

function success(title: string, description?: string) {
  toast.success(title, { description })
}

function error(title: string, description?: string) {
  toast.error(title, { description })
}

function info(title: string, description?: string) {
  toast.info(title, { description })
}

export const tradingToast = {
  orderSubmitted,
  orderFailed,
  orderCancelled,
  positionClosed,
  depositSuccess,
  depositFailed,
  withdrawSuccess,
  withdrawFailed,
  success,
  error,
  info,
}
