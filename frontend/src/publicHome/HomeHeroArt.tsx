// The picture beside the welcome of /home (PORTAL-04 PR-1 redesign): an original, purely decorative composition drawn
// here — a lesson card with its lessons ticked off and a progress bar, a card behind it, rising steps for the levels,
// a sparkle badge, a dotted patch and a few shapes. No photograph, no person, no figure: nothing that could pass for
// the academy's own content, and it looks the same whether or not the academy has a logo. Its colours come from
// publicHome.css (the custom properties of the public pages), so it follows them. Hidden from assistive technology.
export function HomeHeroArt() {
  return (
    <svg className="public-home__art" viewBox="0 0 480 400" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="public-home-art-dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" className="art-dot" />
        </pattern>
        <filter id="public-home-art-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#142033" floodOpacity="0.12" />
        </filter>
      </defs>

      <circle cx="270" cy="205" r="172" className="art-halo" />
      <rect x="326" y="26" width="128" height="96" fill="url(#public-home-art-dots)" />
      <rect x="36" y="262" width="104" height="104" rx="26" className="art-accent-soft" transform="rotate(-10 88 314)" />

      {/* The levels: three rising steps. */}
      <rect x="44" y="94" width="24" height="34" rx="6" className="art-step art-step--1" />
      <rect x="74" y="74" width="24" height="54" rx="6" className="art-step art-step--2" />
      <rect x="104" y="52" width="24" height="76" rx="6" className="art-step art-step--3" />

      {/* The card behind. */}
      <rect x="156" y="74" width="250" height="196" rx="20" className="art-card-back" transform="rotate(6 281 172)" />

      {/* The lesson card. */}
      <g filter="url(#public-home-art-shadow)">
        <rect x="112" y="106" width="276" height="206" rx="20" className="art-card" />
      </g>
      <path d="M132 106h236a20 20 0 0 1 20 20v44H112v-44a20 20 0 0 1 20-20z" className="art-card-head" />
      <circle cx="150" cy="138" r="15" className="art-on-primary" />
      <path d="M145 130.5 159 138l-14 7.5z" className="art-primary" />
      <rect x="178" y="128" width="124" height="10" rx="5" className="art-on-primary" />
      <rect x="178" y="144" width="78" height="8" rx="4" className="art-on-primary-soft" />

      <circle cx="146" cy="196" r="11" className="art-done" />
      <path d="m140.5 196 4 4 7.5-8" className="art-check" />
      <rect x="168" y="191" width="158" height="10" rx="5" className="art-line" />

      <circle cx="146" cy="226" r="11" className="art-done" />
      <path d="m140.5 226 4 4 7.5-8" className="art-check" />
      <rect x="168" y="221" width="126" height="10" rx="5" className="art-line" />

      <circle cx="146" cy="256" r="10" className="art-todo" />
      <rect x="168" y="251" width="140" height="10" rx="5" className="art-line art-line--soft" />

      <rect x="136" y="284" width="228" height="10" rx="5" className="art-track" />
      <rect x="136" y="284" width="146" height="10" rx="5" className="art-progress" />

      {/* A sparkle badge and a few loose shapes. */}
      <g className="art-float">
        <circle cx="396" cy="314" r="36" className="art-badge" filter="url(#public-home-art-shadow)" />
        <path d="M396 293c2.2 11.5 6.5 15.8 18 18-11.5 2.2-15.8 6.5-18 18-2.2-11.5-6.5-15.8-18-18 11.5-2.2 15.8-6.5 18-18z" className="art-accent" />
      </g>
      <circle cx="428" cy="160" r="9" className="art-accent" />
      <rect x="64" y="200" width="20" height="20" rx="5" className="art-primary art-tilt" transform="rotate(18 74 210)" />
      <circle cx="226" cy="44" r="6" className="art-primary-light" />
    </svg>
  )
}
