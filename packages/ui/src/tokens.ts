/**
 * Tectonic Design System Tokens (Version 1 · October 2026)
 *
 * Principles:
 * - Black canvas, one lime: Near-black, greyscale UI; lime (#9df747) marks the one thing that matters.
 * - Pills you tap, cards you read: radius-full for row controls, radius-lg for cards, radius-xl for containers.
 * - Flat, layered by tone: canvas -> surface -> surface-raised -> surface-strong.
 * - Two complete themes: Dark is primary, Light is full-support.
 */

export const tectonicTokens = {
  dark: {
    // Grounds
    canvas: '#0b0b0b',
    surface: '#131313',
    surfaceRaised: '#171717',
    surfaceStrong: '#2b2b2b',
    surfaceMuted: '#3a3a3a',
    line: '#262626',
    lineStrong: '#6b6b6b',

    // Text
    ink: '#f5f5f5',
    inkMuted: '#a3a3a3',
    inkSubtle: '#8a8a8a',

    // Contrast pill & paper
    inverse: '#f3f3f3',
    onInverse: '#0b0b0b',
    onInverseMuted: '#55524f',
    paper: '#fffbfa',
    paperSunken: '#d9d9d9',

    // Lime
    lime: '#9df747',
    limeSoft: '#b5fc96',
    onLime: '#0b0b0b',
    limeText: '#9df747',
    limeTint: '#1c2b12',

    // Status
    positiveFill: '#2f4a1c',
    positiveText: '#c2f59a',
    cautionFill: '#4a4b12',
    cautionText: '#eef07a',
    warningFill: '#4d3110',
    warningText: '#ffbe73',
    dangerFill: '#4f2219',
    dangerText: '#ff9f87',

    // Heat meter
    heat1: '#6b6b6b',
    heat2: '#ff6a4d',
    heat3: '#ff9d3d',
    heat4: '#f2e94e',
    heat5: '#9df747',

    // Charts
    chart1: '#62a802',
    chart2: '#3987e5',
    chart3: '#d55181',
    chart4: '#c98500',
    chart5: '#9085e9',
    chart6: '#d95926',
    chartMuted: '#3a3a3a',
    chartGrid: '#232323',
    chartAxis: '#4a4a4a',

    // Elevation & Focus
    shadowFloat: '0 24px 48px -12px #000000e6, 0 0 0 1px #ffffff14',
    focusRing: '0 0 0 2px #0b0b0b, 0 0 0 4px #9df747',
  },

  light: {
    // Grounds
    canvas: '#f2f2ef',
    surface: '#ffffff',
    surfaceRaised: '#fafaf8',
    surfaceStrong: '#ebebe6',
    surfaceMuted: '#e0e0da',
    line: '#e3e3de',
    lineStrong: '#8a8a83',

    // Text
    ink: '#0b0b0b',
    inkMuted: '#52524e',
    inkSubtle: '#6b6b66',

    // Contrast pill & paper
    inverse: '#141414',
    onInverse: '#f5f5f5',
    onInverseMuted: '#a3a3a3',
    paper: '#1b1b1b',
    paperSunken: '#2e2e2e',

    // Lime
    lime: '#9df747',
    limeSoft: '#b5fc96',
    onLime: '#0b0b0b',
    limeText: '#3a7008',
    limeTint: '#e9f9d6',

    // Status
    positiveFill: '#dcf3c6',
    positiveText: '#2a5409',
    cautionFill: '#f3f1bf',
    cautionText: '#5c5800',
    warningFill: '#fde4c6',
    warningText: '#804000',
    dangerFill: '#fbdcd3',
    dangerText: '#9e2a14',

    // Heat meter
    heat1: '#b8b8b0',
    heat2: '#e0482b',
    heat3: '#c25e00',
    heat4: '#8f8100',
    heat5: '#4f9a0e',

    // Charts
    chart1: '#599b00',
    chart2: '#2a78d6',
    chart3: '#e87ba4',
    chart4: '#eda100',
    chart5: '#6250d6',
    chart6: '#eb6834',
    chartMuted: '#d6d6cf',
    chartGrid: '#ecece7',
    chartAxis: '#c4c4bc',

    // Elevation & Focus
    shadowFloat: '0 20px 40px -12px #0b0b0b33, 0 0 0 1px #0b0b0b0f',
    focusRing: '0 0 0 2px #f2f2ef, 0 0 0 4px #141414',
  },

  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    12: '48px',
  },

  radius: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },

  sizes: {
    railWidth: '72px',
    controlSm: '32px',
    controlMd: '40px',
    controlLg: '48px',
    notch: '22px',
  },

  typography: {
    fontSans: '"Instrument Sans", "Helvetica Neue", Arial, system-ui, sans-serif',
    fontMono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
} as const;

/** Backwards-compatibility alias */
export const tokens = {
  colors: {
    canvas: 'var(--canvas)',
    surface: 'var(--surface)',
    surfaceSubtle: 'var(--surface-raised)',
    surfaceLavender: 'var(--lime-tint)',
    textPrimary: 'var(--ink)',
    textSecondary: 'var(--ink-muted)',
    textMuted: 'var(--ink-subtle)',
    brand: 'var(--lime)',
    brandHover: 'var(--lime-soft)',
    focus: 'var(--lime)',
    borderDecorative: 'var(--line)',
    borderControl: 'var(--line-strong)',
    status: {
      successText: 'var(--positive-text)',
      successSurface: 'var(--positive-fill)',
      warningText: 'var(--warning-text)',
      warningSurface: 'var(--warning-fill)',
      dangerText: 'var(--danger-text)',
      dangerSurface: 'var(--danger-fill)',
      infoText: 'var(--ink-muted)',
      infoSurface: 'var(--surface-strong)',
    },
  },
  typography: {
    fontFamily: 'var(--font-sans)',
    tabularNums: 'tabular-nums',
  },
  radii: {
    control: 'var(--radius-full)',
    surface: 'var(--radius-lg)',
    dialog: 'var(--radius-xl)',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },
} as const;
