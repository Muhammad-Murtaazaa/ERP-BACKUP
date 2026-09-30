/**
 * Omnysync ERP Design System Tokens
 * Strictly following design-system.md:
 * - Neutral Glacier canvas (#F7F8FC)
 * - Ivory surface (#FFFFFF)
 * - Subtle surface (#F1F4F9)
 * - Lavender accent (#F2EEFF)
 * - Brand primary (#5940B8) and hover (#463091)
 * - Deep slate primary text (#182235)
 * - Restrained status colors (Success #146341/#EAF7EF, Danger #A82430/#FDECEF, Warning #7A4700/#FFF4D6, Info #234FA3/#EDF3FF)
 */

export const tokens = {
  colors: {
    canvas: '#F7F8FC',
    surface: '#FFFFFF',
    surfaceSubtle: '#F1F4F9',
    surfaceLavender: '#F2EEFF',
    textPrimary: '#182235',
    textSecondary: '#46536B',
    textMuted: '#5E6A7D',
    brand: '#5940B8',
    brandHover: '#463091',
    focus: '#5B3CC4',
    borderDecorative: '#D9DFEA',
    borderControl: '#7D8799',
    status: {
      successText: '#146341',
      successSurface: '#EAF7EF',
      warningText: '#7A4700',
      warningSurface: '#FFF4D6',
      dangerText: '#A82430',
      dangerSurface: '#FDECEF',
      infoText: '#234FA3',
      infoSurface: '#EDF3FF',
    },
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    tabularNums: 'tabular-nums',
  },
  radii: {
    control: '6px',
    surface: '10px',
    dialog: '12px',
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
