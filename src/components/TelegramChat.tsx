import { FC, useEffect, useRef, useState } from "react"

type Sender = "jenny" | "bot"

interface ChatMessage {
  from: Sender
  time: string
  text: string
  /** photo sent with the message, rendered above the caption */
  image?: string
  /** faded cost/usage footer line Gemini-backed replies print */
  meta?: string
}

const SENDER_LABEL: Record<Sender, string> = {
  jenny: "Jenny Krch",
  bot: "plantyj-bot",
}

// the transcript scrolled through below — a real /identify -> /pick run
// followed by an agentic /ask -> /confirm run, on one evening
const CONVERSATION: ChatMessage[] = [
  {
    from: "jenny",
    time: "9:04 PM",
    image: "/images/H ric/1779156477.jpg",
    text: "/identify perennial in fy maybe a native huechera",
  },
  {
    from: "bot",
    time: "9:04 PM",
    text: "Identifying — options will arrive shortly.",
  },
  {
    from: "bot",
    time: "9:06 PM",
    text: `The very hairy stems and scalloped, rounded leaf shape are a textbook match for Prairie Alumroot, our local native Heuchera.

Identification options:

1. Prairie Alumroot (Heuchera richardsonii) — high confidence
   new plant. Rounded, shallowly lobed basal leaves and extremely hairy (hirsute) petioles strongly confirm a native Heuchera. Zone set from your note.
   caption: // Heuchera richardsonii // Prairie Alumroot // fy
   → /pick 1

2. Foamflower (Tiarella cordifolia) — low confidence
   existing plant "T cor". Another native woodland plant with hairy stems, but its leaves are typically more deeply cleft (maple-like) than these.
   caption: T cor // // // fy
   → /pick 2

Reply /pick N to save the photo with that identification (committed like a normal upload), or /cancel to discard.`,
    meta: "[$0.0058 | 2,706 in / 242 out]",
  },
  {
    from: "jenny",
    time: "9:07 PM",
    text: "/pick 1",
  },
  {
    from: "bot",
    time: "9:08 PM",
    text: `Picked option 1: Prairie Alumroot (Heuchera richardsonii) — high confidence

Added pic #93: H ric
  Common: Prairie Alumroot
  Full: Heuchera richardsonii
  Zone: Front Yard (fy)
  → images/H ric/1779156477.jpg`,
  },
  {
    from: "jenny",
    time: "9:13 PM",
    text: "/ask propose any relevant new relationships for the newer plants and swallowtail caterpillar.",
  },
  {
    from: "bot",
    time: "9:13 PM",
    text: "Queued — reply will arrive shortly.",
  },
  {
    from: "bot",
    time: "9:14 PM",
    text: `I've proposed a few new ecological relationships for your recent additions, avoiding the companion type as requested.

Specifically, I linked the Black Swallowtail to the Golden Alexanders as a host plant (since you found caterpillars on them), added Pearly Everlasting as a host plant for the American Painted Lady, connected the new Prairie Violet to your Carpenter Ants for seed dispersal, and noted Cardinals as frugivores for the Black Chokeberry.

You can review the numbered list below and run /confirm to apply them!

Proposed commands:
  1. /relate host-plant // P pol // Z aur
     Your photo notes several Black Swallowtail caterpillars were found on the Golden Alexanders.
  2. /relate host-plant // V virg // A mar
     Pearly Everlasting is a primary host plant for the American Painted Lady caterpillar.
  3. /relate seed-disperser // C pen // V ped
     Like your other violets, the new Prairie Violet relies on ants for seed dispersal (myrmecochory).
  4. /relate frugivore // c card // A mel
     Cardinals will forage the berries produced by your new Black Chokeberry.

Reply /confirm to run all, /confirm 1 3 to run a subset, or /cancel to drop.`,
    meta: "[$0.0299 | +12,890 cache-create, 25,780 cached, 28,075 in / 281 out]",
  },
  {
    from: "jenny",
    time: "9:16 PM",
    text: "/confirm",
  },
  {
    from: "bot",
    time: "9:16 PM",
    text: "Queued 4 command(s) — batched in chunks of 25/min (~1 min). Summary will arrive when complete.",
  },
  {
    from: "bot",
    time: "9:17 PM",
    text: `Ran 4 command(s):
1. /relate host-plant // P pol // Z aur
   OK: Related #44: P pol → Z aur (Host Plant)
2. /relate host-plant // V virg // A mar
   OK: Related #45: V virg → A mar (Host Plant)
3. /relate seed-disperser // C pen // V ped
   OK: Related #46: C pen → V ped (Seed Disperser)
4. /relate frugivore // c card // A mel
   OK: Related #47: c card → A mel (Fruit / Nut Consumer)`,
  },
]

const Bubble: FC<{ message: ChatMessage; showName: boolean }> = ({
  message,
  showName,
}) => {
  const outgoing = message.from === "jenny"

  // user messages are slash commands — highlight the command token the way
  // Telegram renders it as a tappable link (not as code/monospace)
  const renderText = (text: string) => {
    if (!outgoing) return text
    const m = text.match(/^(\/\S+)(\s[\s\S]*)?$/)
    if (!m) return text
    return (
      <>
        <span className="font-semibold text-[#a8d195]">{m[1]}</span>
        {m[2]}
      </>
    )
  }

  return (
    <div className={`flex w-full ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[88%] overflow-hidden rounded-2xl text-[12.5px] leading-snug ${
          outgoing
            ? "rounded-br-md bg-[#3f6a30] text-[#eef7e6]"
            : "rounded-bl-md bg-[#3a2c1d] text-[#ece1cc]"
        }`}
      >
        {message.image && (
          <img
            src={message.image}
            alt=""
            loading="lazy"
            className="block max-h-60 w-full object-cover"
          />
        )}

        <div className="px-3 py-1.5">
          {showName && !outgoing && (
            <div className="mb-0.5 text-[11.5px] font-semibold text-[#d4b483]">
              {SENDER_LABEL[message.from]}
            </div>
          )}

          <div
            className={`whitespace-pre-wrap break-words ${
              outgoing ? "text-[#f5fae9]" : "text-[#dfd6c3]"
            }`}
          >
            {renderText(message.text)}
          </div>

          {message.meta && (
            <div className="mt-1 text-[10px] text-[#9c8870]">{message.meta}</div>
          )}

          <div
            className={`mt-0.5 text-right text-[10px] ${
              outgoing ? "text-[#bcdba8]" : "text-[#a89072]"
            }`}
          >
            {message.time}
          </div>
        </div>
      </div>
    </div>
  )
}

interface TelegramChatProps {
  className?: string
}

const TelegramChat: FC<TelegramChatProps> = ({ className }) => {
  const [expanded, setExpanded] = useState(false)

  // grab-to-scroll with mobile-style physics: drag to fling the transcript,
  // momentum carries it with friction, and the edges rubber-band + spring back.
  // touch input keeps the browser's own native momentum, so we skip it.
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const drag = useRef({
    active: false,
    startY: 0,
    startScroll: 0,
    lastY: 0,
    lastT: 0,
    v: 0, // pointer velocity, px/ms (positive = moving down)
  })
  // rubber-band offset state, driven imperatively to keep the rAF loop smooth
  const phys = useRef({ raf: 0, offset: 0, vScroll: 0 })

  const maxScroll = () => {
    const el = scrollRef.current
    return el ? el.scrollHeight - el.clientHeight : 0
  }

  // iOS-style resistance: the further you pull past the edge, the harder it gets
  const rubber = (x: number) => {
    const d = scrollRef.current?.clientHeight || 1
    const c = 0.55
    return (Math.sign(x) * (Math.abs(x) * d * c)) / (d + c * Math.abs(x))
  }

  const applyOffset = () => {
    const node = contentRef.current
    if (node)
      node.style.transform = phys.current.offset
        ? `translateY(${phys.current.offset}px)`
        : ""
  }

  const stopAnim = () => {
    if (phys.current.raf) cancelAnimationFrame(phys.current.raf)
    phys.current.raf = 0
  }

  const tick = () => {
    const el = scrollRef.current
    const p = phys.current
    if (!el) return
    const max = maxScroll()

    // inertial scroll: a long, low-friction glide like a real touchscreen
    if (Math.abs(p.offset) < 0.5 && Math.abs(p.vScroll) > 0.01) {
      const next = el.scrollTop - p.vScroll * 16
      if (next < 0) {
        el.scrollTop = 0
        // a small, capped nudge past the edge — eased away, not sprung
        p.offset = Math.min(64, -p.vScroll * 5)
        p.vScroll = 0
      } else if (next > max) {
        el.scrollTop = max
        p.offset = Math.max(-64, -p.vScroll * 5)
        p.vScroll = 0
      } else {
        el.scrollTop = next
        p.vScroll *= 0.97 // ~iOS deceleration; long smooth coast
      }
    } else {
      p.vScroll = 0
    }

    // monotonic ease back to rest: glides home without overshoot/bounce
    p.offset *= 0.86
    if (Math.abs(p.offset) < 0.3) p.offset = 0
    applyOffset()

    if (p.vScroll !== 0 || p.offset !== 0) {
      p.raf = requestAnimationFrame(tick)
    } else {
      p.raf = 0
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return
    const el = scrollRef.current
    if (!el) return
    stopAnim()
    phys.current.vScroll = 0
    drag.current = {
      active: true,
      startY: e.clientY,
      startScroll: el.scrollTop,
      lastY: e.clientY,
      lastT: performance.now(),
      v: 0,
    }
    setDragging(true)
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = scrollRef.current
    if (!d.active || !el) return

    const raw = d.startScroll - (e.clientY - d.startY)
    const max = maxScroll()
    let over = 0
    if (raw < 0) over = raw
    else if (raw > max) over = raw - max
    el.scrollTop = Math.max(0, Math.min(max, raw))
    phys.current.offset = over ? -rubber(over) : 0
    applyOffset()

    const now = performance.now()
    const dt = now - d.lastT
    if (dt > 0) {
      const sample = (e.clientY - d.lastY) / dt
      d.v = d.v * 0.3 + sample * 0.7 // low-pass so the fling feels stable
    }
    d.lastY = e.clientY
    d.lastT = now
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    setDragging(false)
    scrollRef.current?.releasePointerCapture(e.pointerId)

    // a stale sample (paused before releasing) shouldn't fling
    const fresh = performance.now() - d.lastT < 60
    phys.current.vScroll = fresh && Math.abs(d.v) > 0.04 ? d.v : 0
    if (phys.current.vScroll || phys.current.offset) {
      stopAnim()
      phys.current.raf = requestAnimationFrame(tick)
    }
  }

  useEffect(() => stopAnim, [])

  return (
    <div
      className={`overflow-hidden rounded-xl bg-surface shadow-[5px_6px_11px_0px_rgba(0,0,0,0.35)] ${
        className ?? "mx-auto w-full max-w-md"
      }`}
      style={{ fontFamily: "helvetica, arial, sans-serif" }}
    >
      {/* header */}
      <div className="flex items-center gap-3 bg-[#18301e] px-4 py-2.5 text-ink">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/25 text-base">
          🌿
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">PlantyJ</div>
          <div className="truncate text-[11px] text-ink-muted">
            Jenny Krch, plantyj-bot
          </div>
        </div>
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-ink-muted"
          fill="currentColor"
        >
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </div>

      {/* scrollable message area */}
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`overflow-y-auto overscroll-contain px-3 py-3 transition-[height] duration-300 [scrollbar-color:#3a4f33_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb:hover]:bg-[#4f6745] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a4f33] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 ${
          dragging ? "cursor-grabbing select-none" : "cursor-grab"
        } ${expanded ? "h-[40rem]" : "h-[22rem]"}`}
        style={{
          background:
            "radial-gradient(circle at 18% 12%, rgba(127,176,105,0.22), transparent 45%), radial-gradient(circle at 85% 80%, rgba(166,124,82,0.18), transparent 45%), #131a10",
        }}
      >
        <div ref={contentRef} className="will-change-transform">
          <div className="mb-3 flex justify-center">
            <span className="rounded-full bg-ink/[0.07] px-3 py-0.5 text-[10.5px] font-medium text-ink-muted">
              May 18, 2026
            </span>
          </div>

          <div className="space-y-2">
            {CONVERSATION.map((message, i) => {
              const prev = CONVERSATION[i - 1]
              const showName = !prev || prev.from !== message.from
              return (
                <div key={i} className={showName && i > 0 ? "pt-1.5" : ""}>
                  <Bubble message={message} showName={showName} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* expand / collapse */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-ink-faint/15 bg-[#18301e] py-1.5 text-[11px] text-ink-muted transition-colors hover:text-ink"
      >
        {expanded ? "Collapse" : "Expand"}
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 transition-transform duration-300 ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* decorative composer — not interactive */}
      <div className="flex items-center gap-2 border-t border-ink-faint/15 bg-[#18301e] px-3 py-2">
        <div className="flex flex-1 items-center rounded-full bg-[#1e3826] px-4 py-1.5 text-[12.5px] text-ink/80">
          Message
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-dim">
          <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-px fill-white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default TelegramChat
