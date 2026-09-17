"use client"

import Image from "next/image"
import { useState } from "react"
import type { Ecosystem } from "@/lib/config/markets"

interface Props {
  ecosystem: Ecosystem
  size: number
  className?: string
}

export function EcosystemLogo({ ecosystem, size, className }: Props) {
  const [errored, setErrored] = useState(false)

  if (errored) {
    return (
      <span
        aria-label={ecosystem.name}
        className={`inline-block shrink-0 rounded-full ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          backgroundColor: ecosystem.color,
        }}
      />
    )
  }

  return (
    <Image
      src={ecosystem.logo}
      alt={ecosystem.name}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={`shrink-0 rounded-full ${className ?? ""}`}
    />
  )
}
