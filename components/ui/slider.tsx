"use client"

interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  variant: "buy" | "sell"
  showInput?: boolean
  min?: number
  max?: number
  steps?: number[]
  clickableSteps?: number
  customColors?: {
    trackBg?: string
    activeColor?: string
    inactiveColor?: string
    thumbColor?: string
    thumbBorderColor?: string
    progressColor?: string
  }
  inputSuffix?: string
  inputClassName?: string
  currentValue?: number
  showCurrentIndicator?: boolean
}

export function Slider({
  value,
  onValueChange,
  variant,
  showInput = true,
  min = 0,
  max = 100,
  clickableSteps = 3,
  customColors,
  inputSuffix = "%",
  inputClassName,
  currentValue,
  showCurrentIndicator = false,
}: SliderProps) {
  const isBuy = variant === "buy"

  // Custom colors or default
  const trackBg = customColors?.trackBg
  const activeMarkerColor = customColors?.activeColor
  const inactiveMarkerColor = customColors?.inactiveColor
  const thumbColor = customColors?.thumbColor
  const thumbBorderColor = customColors?.thumbBorderColor
  const progressColor = customColors?.progressColor

  // Visual scale: 0 to max (Lighter-style). Thumb min is `min` but track starts at 0.
  // Generate step markers: evenly spaced from 0 to max
  const stepValues = Array.from(
    { length: clickableSteps + 2 },
    (_, i) => (i / (clickableSteps + 1)) * max
  )

  // Generate clickable step values: evenly spaced between 0 and max (excluding endpoints)
  const clickableStepSize = max / (clickableSteps + 1)
  const clickableStepValues = Array.from({ length: clickableSteps }, (_, i) =>
    Math.max(min, clickableStepSize * (i + 1))
  )

  return (
    <div className="flex w-full items-center justify-between gap-2 pl-1">
      <div className="relative flex h-6 w-full cursor-pointer touch-none items-center select-none">
        {/* Track background */}
        <div
          className={`relative h-2 grow overflow-visible rounded-full before:pointer-events-none before:absolute before:inset-y-0 before:-right-1 before:-left-1 before:-z-10 before:rounded-full before:content-[''] ${
            trackBg ? "" : "bg-muted/30 before:bg-muted/30"
          }`}
          style={
            trackBg
              ? ({
                  backgroundColor: trackBg,
                  "--track-bg": trackBg,
                } as React.CSSProperties & { "--track-bg": string })
              : undefined
          }
          data-track-bg={trackBg || undefined}
        >
          {/* Step markers */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between cursor-pointer">
            {stepValues.map((step, index) => {
              const isFirstOrLast =
                index === 0 || index === stepValues.length - 1
              const isActive = value >= step

              return (
                <div
                  key={step}
                  className="pointer-events-none flex items-center"
                >
                  {isFirstOrLast ? (
                    <div
                      className={`h-2.5 w-0.5 rounded-xs border ${
                        !activeMarkerColor && !inactiveMarkerColor
                          ? isActive
                            ? isBuy
                              ? "border-success"
                              : "border-destructive"
                            : "border-muted-foreground/30"
                          : ""
                      }`}
                      style={
                        activeMarkerColor || inactiveMarkerColor
                          ? {
                              borderColor: isActive
                                ? activeMarkerColor ||
                                  (isBuy
                                    ? "oklch(0.55 0.15 145)"
                                    : "oklch(0.55 0.2 25)")
                                : inactiveMarkerColor || "oklch(0.25 0 0)",
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <>
                      <div
                        className={`rounded-xs h-1.5 w-px ${
                          !activeMarkerColor && !inactiveMarkerColor
                            ? isActive
                              ? isBuy
                                ? "bg-success"
                                : "bg-destructive"
                              : "bg-muted-foreground/30"
                            : ""
                        }`}
                        style={
                          activeMarkerColor || inactiveMarkerColor
                            ? {
                                backgroundColor: isActive
                                  ? activeMarkerColor ||
                                    (isBuy
                                      ? "oklch(0.55 0.15 145)"
                                      : "oklch(0.55 0.2 25)")
                                  : inactiveMarkerColor || "oklch(0.25 0 0)",
                              }
                            : undefined
                        }
                      />
                      <div
                        className={`rounded-xs h-1.5 w-px ${
                          !activeMarkerColor && !inactiveMarkerColor
                            ? isActive
                              ? isBuy
                                ? "bg-success"
                                : "bg-destructive"
                              : "bg-muted-foreground/30"
                            : ""
                        }`}
                        style={
                          activeMarkerColor || inactiveMarkerColor
                            ? {
                                backgroundColor: isActive
                                  ? activeMarkerColor ||
                                    (isBuy
                                      ? "oklch(0.55 0.15 145)"
                                      : "oklch(0.55 0.2 25)")
                                  : inactiveMarkerColor || "oklch(0.25 0 0)",
                              }
                            : undefined
                        }
                      />
                      <div
                        className={`rounded-xs h-1.5 w-px ${
                          !activeMarkerColor && !inactiveMarkerColor
                            ? isActive
                              ? isBuy
                                ? "bg-success"
                                : "bg-destructive"
                              : "bg-muted-foreground/30"
                            : ""
                        }`}
                        style={
                          activeMarkerColor || inactiveMarkerColor
                            ? {
                                backgroundColor: isActive
                                  ? activeMarkerColor ||
                                    (isBuy
                                      ? "oklch(0.55 0.15 145)"
                                      : "oklch(0.55 0.2 25)")
                                  : inactiveMarkerColor || "oklch(0.25 0 0)",
                              }
                            : undefined
                        }
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Progress fill with gradient */}
          <div
            className={`pointer-events-none absolute inset-y-0.5 right-0 -left-0.5 rounded-l-xs ${
              progressColor ? "" : "opacity-50"
            } ${
              !progressColor
                ? isBuy
                  ? "bg-gradient-to-r from-success to-success/70"
                  : "bg-gradient-to-r from-destructive to-destructive/70"
                : ""
            }`}
            style={{
              left: "0%",
              right: `${100 - (value / max) * 100}%`,
              ...(progressColor ? { backgroundColor: progressColor } : {}),
            }}
          />

          {/* Step markers — visual only. They used to be `pointer-events-auto`
              click targets sitting ABOVE the range input, which swallowed
              pointerdown on/near a preset (e.g. the thumb parked at 50%) so the
              drag never started. The range input below now owns all pointer
              interaction (drag + native click-to-position). */}
          <div className="pointer-events-none absolute inset-0">
            {clickableStepValues.map((step) => (
              <span
                key={step}
                aria-hidden
                className="pointer-events-none absolute top-1/2 z-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(step / max) * 100}%` }}
              />
            ))}
          </div>
        </div>

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            left:
              value === 0
                ? "0px"
                : value === max
                  ? "calc(100% - 6px)"
                  : `calc(${(value / max) * 100}% - 3px)`,
          }}
        >
          <div
            role="slider"
            aria-label="Slider Thumb"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-orientation="horizontal"
            tabIndex={0}
            className={`flex h-5 w-1.5 rounded-lg border-[0.4px] backdrop-blur-xl ${
              !thumbColor && !thumbBorderColor
                ? isBuy
                  ? "border-success/40 bg-success"
                  : "border-destructive/40 bg-destructive"
                : ""
            }`}
            style={
              thumbColor || thumbBorderColor
                ? {
                    borderColor:
                      thumbBorderColor ||
                      (isBuy
                        ? "oklch(0.55 0.15 145 / 0.4)"
                        : "oklch(0.55 0.2 25 / 0.4)"),
                    backgroundColor:
                      thumbColor ||
                      (isBuy ? "oklch(0.55 0.15 145)" : "oklch(0.55 0.2 25)"),
                  }
                : undefined
            }
            aria-valuenow={value}
          />
        </div>

        {/* Current value indicator */}
        {showCurrentIndicator && currentValue !== undefined && (
          <div
            className="pointer-events-none absolute top-2 z-10 flex -translate-x-1/2 flex-col items-center"
            style={{
              left:
                currentValue === 0
                  ? "0px"
                  : currentValue === max
                    ? "calc(100% - 6px)"
                    : `calc(${(currentValue / max) * 100}% - 3px)`,
            }}
          >
            <span className="flex shrink-0 items-center justify-center pointer-events-none h-5 w-2.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 7 14"
                fill="none"
                className="size-full"
              >
                <path
                  d="M3.4031 0.377385C3.4289 0.2772 3.5711 0.2772 3.5969 0.377385L3.7889 1.12543C3.7907 1.1327 3.7918 1.14016 3.792 1.14767L4.0811 12.1887C4.0824 12.2373 4.1184 12.2779 4.1665 12.285L6.498 12.6299C6.5258 12.634 6.5506 12.6497 6.5663 12.673L6.983 13.2929C6.9941 13.3094 7 13.3288 7 13.3487V13.9C7 13.9552 6.9552 14 6.9 14H0.1C0.0448004 14 0 13.9552 0 13.9V13.3487C0 13.3288 0.0059002 13.3094 0.0170002 13.2929L0.4337 12.673C0.4494 12.6497 0.4742 12.634 0.502 12.6299L2.8335 12.285C2.8816 12.2779 2.9176 12.2373 2.9189 12.1887L3.208 1.14767C3.2082 1.14016 3.2093 1.1327 3.2111 1.12543L3.4031 0.377385Z"
                  fill="#F3F3F3"
                ></path>
              </svg>
            </span>
            <span className="text-[10px] text-gray-6">Current</span>
          </div>
        )}

        {/* Slider input (invisible but functional) */}
        <input
          type="range"
          role="slider"
          aria-label="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${value} units`}
          min={0}
          max={max}
          value={value}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value)
            onValueChange(Math.max(min, v))
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
        />
      </div>

      {/* Percentage input */}
      {showInput && (
        <div
          className={
            inputClassName ||
            "flex w-full shrink-0 items-center gap-1 rounded-sm border text-xs text-foreground transition-all h-6 px-1 border-input bg-background hover:border-input/80 hover:bg-muted/50 max-w-12"
          }
        >
          <input
            className="w-full bg-transparent text-xs transition-all placeholder:text-muted-foreground text-left placeholder:text-left"
            placeholder="0"
            inputMode="numeric"
            // Cap fractional values (e.g. a percentage derived from an amount)
            // at 2 decimals for display; integer callers (leverage, size %)
            // are unaffected since Number.isInteger short-circuits.
            value={
              value === 0
                ? ""
                : Number.isInteger(value)
                  ? value
                  : Math.round(value * 100) / 100
            }
            onChange={(e) => {
              const inputValue = e.target.value.trim()
              // Allow empty input to set value to 0
              if (inputValue === "") {
                onValueChange(0)
                return
              }
              const newValue = Number.parseInt(inputValue)
              if (!Number.isNaN(newValue) && newValue >= 0 && newValue <= max) {
                onValueChange(newValue)
              }
            }}
          />
          <span>{inputSuffix}</span>
        </div>
      )}
    </div>
  )
}
