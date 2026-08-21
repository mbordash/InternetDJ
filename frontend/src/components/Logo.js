import React, { useId } from 'react';

/**
 * InternetDJ logo, drawn as inline SVG so it inherits the neon palette,
 * stays crisp at any size, and needs no extra network request.
 *
 *   variant  'disc' | 'crest' | 'tube' | 'tape'
 *   mode     'lockup' (mark + wordmark) | 'mark' (square, for favicons/avatars)
 *
 * Every gradient/filter id is namespaced with useId so multiple logos can
 * coexist on one page without their defs colliding.
 */

const CHROME_STOPS = [
    ['0%', '#ffffff'],
    ['18%', '#cfe6ff'],
    ['42%', '#4f9de0'],
    ['50%', '#0b2647'],
    ['58%', '#5fb4ef'],
    ['74%', '#ffc9ee'],
    ['88%', '#ffffff'],
    ['100%', '#d8b8ff'],
];

function Defs({ uid, glow = 3 }) {
    return (
        <defs>
            <linearGradient id={`${uid}-chrome`} x1="0" y1="0" x2="0" y2="1">
                {CHROME_STOPS.map(([offset, color]) => (
                    <stop key={offset} offset={offset} stopColor={color} />
                ))}
            </linearGradient>

            <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffe08a" />
                <stop offset="38%" stopColor="#ff9d4d" />
                <stop offset="72%" stopColor="#ff2f8e" />
                <stop offset="100%" stopColor="#b5179e" />
            </linearGradient>

            <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff2f8e" />
                <stop offset="50%" stopColor="#9d4edd" />
                <stop offset="100%" stopColor="#00f0ff" />
            </linearGradient>

            {/* Classic retro sun: solid on top, breaking into bands toward the base. */}
            <mask id={`${uid}-bands`}>
                <rect x="0" y="0" width="120" height="62" fill="#fff" />
                <rect x="0" y="66" width="120" height="8" fill="#fff" />
                <rect x="0" y="78" width="120" height="7" fill="#fff" />
                <rect x="0" y="89" width="120" height="5" fill="#fff" />
                <rect x="0" y="98" width="120" height="4" fill="#fff" />
                <rect x="0" y="106" width="120" height="3" fill="#fff" />
            </mask>

            <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation={glow} result="b" />
                <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>
    );
}

/* ---------- Wordmark shared by the lockups -------------------------------- */

function Wordmark({ uid, x = 138 }) {
    return (
        <g>
            <text
                x={x}
                y="50"
                fill="#00f0ff"
                fontFamily="'Orbitron', 'Trebuchet MS', sans-serif"
                fontWeight="700"
                fontSize="23"
                letterSpacing="7.5"
                filter={`url(#${uid}-glow)`}
            >
                INTERNET
            </text>
            <text
                x={x - 2}
                y="108"
                fill={`url(#${uid}-chrome)`}
                stroke="#ff2f8e"
                strokeWidth="0.6"
                fontFamily="'Orbitron', 'Trebuchet MS', sans-serif"
                fontWeight="900"
                fontSize="60"
                letterSpacing="2"
            >
                DJ
            </text>
        </g>
    );
}

/* ---------- A. Sunset Disc — the sun and the record are the same shape ----- */

function DiscMark({ uid }) {
    return (
        <g>
            <circle cx="60" cy="60" r="52" fill="#0a0418" />
            <g mask={`url(#${uid}-bands)`}>
                <circle cx="60" cy="60" r="46" fill={`url(#${uid}-sun)`} />
            </g>
            {/* Grooves, so the sun also reads as vinyl. */}
            <circle cx="60" cy="60" r="39" fill="none" stroke="rgba(4,1,12,0.55)" strokeWidth="1.2" />
            <circle cx="60" cy="60" r="33" fill="none" stroke="rgba(4,1,12,0.55)" strokeWidth="1.2" />
            <circle cx="60" cy="60" r="26" fill="none" stroke="rgba(4,1,12,0.55)" strokeWidth="1.2" />
            {/* Horizon: the line the sun is setting behind. */}
            <line x1="16" y1="60" x2="104" y2="60" stroke="#00f0ff" strokeWidth="1.6" opacity="0.9" />
            <circle cx="60" cy="60" r="9" fill="#04010c" />
            <circle cx="60" cy="60" r="9" fill="none" stroke="#00f0ff" strokeWidth="2" />
            <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="#00f0ff"
                strokeWidth="2.5"
                filter={`url(#${uid}-glow)`}
            />
        </g>
    );
}

/* ---------- B. Chrome Crest — the existing shield, re-cut in neon --------- */

const SHIELD = 'M14 10 H106 V86 A24 24 0 0 1 82 110 H62 L14 84 Z';

function CrestMark({ uid, compact = false }) {
    return (
        <g>
            <path d={SHIELD} fill="#0a0418" />
            {/* Faint grid inside the shield. */}
            <g clipPath={`url(#${uid}-shieldclip)`} opacity="0.5">
                {[26, 40, 54, 68, 82, 96].map((y) => (
                    <line key={y} x1="14" y1={y} x2="106" y2={y} stroke="#9d4edd" strokeWidth="0.7" />
                ))}
                {[28, 46, 64, 82, 100].map((x) => (
                    <line key={x} x1={x} y1="10" x2={x} y2="110" stroke="#9d4edd" strokeWidth="0.7" />
                ))}
            </g>
            <clipPath id={`${uid}-shieldclip`}><path d={SHIELD} /></clipPath>
            <path
                d={SHIELD}
                fill="none"
                stroke={`url(#${uid}-edge)`}
                strokeWidth="3.5"
                filter={`url(#${uid}-glow)`}
            />
            {!compact && (
                <text
                    x="60" y="40" textAnchor="middle"
                    fill="#00f0ff"
                    fontFamily="'Orbitron', 'Trebuchet MS', sans-serif"
                    fontWeight="700" fontSize="13" letterSpacing="2.4"
                >
                    INTERNET
                </text>
            )}
            <text
                x="60" y={compact ? 82 : 92} textAnchor="middle"
                fill={`url(#${uid}-chrome)`}
                fontFamily="'Orbitron', 'Trebuchet MS', sans-serif"
                fontWeight="900" fontSize={compact ? 54 : 46}
            >
                DJ
            </text>
        </g>
    );
}

/* ---------- C. Neon Tube — a bent-glass club sign ------------------------- */

function TubeLockup({ uid }) {
    const common = {
        x: 210,
        y: 68,
        textAnchor: 'middle',
        fontFamily: "'Orbitron', 'Trebuchet MS', sans-serif",
        fontWeight: 900,
        fontSize: 46,
        letterSpacing: 1,
    };
    return (
        <g>
            {/* Outer bloom, then the hot glass core. */}
            <text {...common} fill="none" stroke="#ff2f8e" strokeWidth="7" strokeLinejoin="round" opacity="0.55" filter={`url(#${uid}-glow)`}>
                InternetDJ
            </text>
            <text {...common} fill="none" stroke="#00f0ff" strokeWidth="3.4" strokeLinejoin="round" filter={`url(#${uid}-glow)`}>
                InternetDJ
            </text>
            <text {...common} fill="none" stroke="#ffffff" strokeWidth="1.1" strokeLinejoin="round">
                InternetDJ
            </text>
            {/* Mount rail + pins, like a real sign. */}
            <line x1="46" y1="88" x2="374" y2="88" stroke="#9d4edd" strokeWidth="2" opacity="0.75" />
            {[64, 210, 356].map((x) => (
                <circle key={x} cx={x} cy="88" r="3.2" fill="#ff2f8e" filter={`url(#${uid}-glow)`} />
            ))}
            <text
                x="210" y="106" textAnchor="middle"
                fill="#00f0ff" opacity="0.85"
                fontFamily="'Press Start 2P', monospace"
                fontSize="8" letterSpacing="3"
            >
                EST. 1997
            </text>
        </g>
    );
}

/* ---------- D. Tape Deck — cassette whose reels are the O's --------------- */

function TapeMark({ uid }) {
    return (
        <g>
            <rect x="8" y="26" width="104" height="68" rx="6" fill="#0a0418"
                  stroke={`url(#${uid}-edge)`} strokeWidth="3" filter={`url(#${uid}-glow)`} />
            <rect x="18" y="34" width="84" height="20" rx="2" fill="#ff2f8e" opacity="0.22" />
            <text
                x="60" y="49" textAnchor="middle"
                fill="#00f0ff"
                fontFamily="'Press Start 2P', monospace"
                fontSize="8" letterSpacing="1"
            >
                IDJ
            </text>
            {[40, 80].map((cx) => (
                <g key={cx}>
                    <circle cx={cx} cy="72" r="13" fill="#04010c" stroke="#00f0ff" strokeWidth="2" />
                    <circle cx={cx} cy="72" r="4.5" fill="none" stroke="#ff2f8e" strokeWidth="2" />
                    {[0, 60, 120].map((a) => (
                        <line
                            key={a}
                            x1={cx - 13 * Math.cos((a * Math.PI) / 180)}
                            y1={72 - 13 * Math.sin((a * Math.PI) / 180)}
                            x2={cx + 13 * Math.cos((a * Math.PI) / 180)}
                            y2={72 + 13 * Math.sin((a * Math.PI) / 180)}
                            stroke="#00f0ff"
                            strokeWidth="1.6"
                            opacity="0.5"
                        />
                    ))}
                </g>
            ))}
            <line x1="53" y1="72" x2="67" y2="72" stroke="#ffb020" strokeWidth="3" />
        </g>
    );
}

/* ---------- Public component --------------------------------------------- */

const MARKS = { disc: DiscMark, crest: CrestMark, tape: TapeMark };

export default function Logo({ variant = 'disc', mode = 'lockup', className = '', title = 'InternetDJ' }) {
    const uid = useId().replace(/:/g, '');

    if (variant === 'tube') {
        // The tube concept is a wordmark, so its "mark" falls back to the disc.
        if (mode === 'mark') return <Logo variant="disc" mode="mark" className={className} title={title} />;
        return (
            <svg viewBox="0 0 420 120" className={className} role="img" aria-label={title} preserveAspectRatio="xMinYMid meet">
                <Defs uid={uid} glow={4} />
                <TubeLockup uid={uid} />
            </svg>
        );
    }

    const Mark = MARKS[variant] || DiscMark;

    if (mode === 'mark') {
        return (
            <svg viewBox="0 0 120 120" className={className} role="img" aria-label={title}>
                <Defs uid={uid} />
                <Mark uid={uid} />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 360 120" className={className} role="img" aria-label={title} preserveAspectRatio="xMinYMid meet">
            <Defs uid={uid} />
            <Mark uid={uid} compact />
            <Wordmark uid={uid} />
        </svg>
    );
}
