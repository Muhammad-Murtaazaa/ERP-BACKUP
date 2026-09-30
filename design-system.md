# Omnysync ERP design system
Direction: calm precision. Ivory and glacier-tinted work surfaces, restrained lavender accents, crisp typography and dense but readable data. The product should feel designed for serious work, with visual quality sustained across forms, tables, reports, native clients and difficult states.

## Design principles
Task before decoration; one clear primary action per context; stable navigation; truthful states; progressive disclosure; keyboard efficiency; user-controlled density; consistent terminology; visible source and consequence; no ornamental charts. Show the next useful action, not every possible setting. UI polish is a release criterion.

## Semantic tokens
Base values below define the light theme. Map tokens to every component; do not hardcode per-module colors.
| Token | Value | Use |
| --- | --- | --- |
| canvas | #F7F8FC | Neutral glacier workspace |
| surface | #FFFFFF | Main working panels |
| surface-subtle | #F1F4F9 | Table hover/grouping and secondary panels |
| surface-lavender | #F2EEFF | Selected region/accent background, limited use |
| text-primary | #182235 | Main content |
| text-secondary | #46536B | Supporting content |
| text-muted | #5E6A7D | Descriptive metadata; still contrast-checked |
| brand | #5940B8 | Primary action, selected navigation |
| brand-hover | #463091 | Hover primary action |
| focus | #5B3CC4 | Distinct focus ring |
| border-decorative | #D9DFEA | Nonessential dividers |
| border-control | #7D8799 | Input/control boundaries where needed for contrast |
| success-text | #146341 | Success state labels |
| success-surface | #EAF7EF | Success background |
| warning-text | #7A4700 | Warning text |
| warning-surface | #FFF4D6 | Warning background |
| danger-text | #A82430 | Errors/destructive labels |
| danger-surface | #FDECEF | Error background |
| info-text | #234FA3 | Informational text |
| info-surface | #EDF3FF | Informational background |

Validate rendered foreground/background pairs, borders and focus states; decorative border is not an adequate control outline. Do not place lavender text on lavender fill. Dark mode is a separately tested semantic mapping, not automatic color inversion. Brand overrides must pass accessibility and state differentiation before publishing.

## Typography, numbers and spacing
Use a locally bundled licensed sans-serif with broad script coverage; Inter candidate for Latin and Noto-compatible fallback for Urdu/Arabic. No required font CDN. Numeric tables use tabular numerals; align amounts right with visible currency context; do not clip minus signs or parenthesize ambiguously.

Type scale: page title 28/36 px semibold; section 20/28; subsection 16/24; body/control 14/20; supporting 13/18; dense data 13/18. Touch modes generally 16/24 for input text. Avoid critical text below 12 px. Standard spacing tokens: 4, 8, 12, 16, 24, 32, 48. Control radius 6; surface radius 10; dialogs 12. Use a 1 px crisp border and restrained shadow for overlays; financial pages do not need floating metric cards everywhere.

## Layout and responsiveness
Navigation expanded 240 px, collapsed 64 px; top bar 56-64 px; context header separate from data controls. Desktop content padding 24, compact/tablet 16, mobile 12-16. Wide tables use bounded horizontal scrolling with row identifier pinned where appropriate, never page-wide overflow. Detail views support a 2-column body/summary layout on desktop and stacked reading order on small screens.

Design and inspect at 1440x900, 1920x1080, 1280x800, 1024x768, 768px tablet and 390px mobile. Exact pixels define tokens and alignment, not a frozen screen that breaks at zoom or translation. Reflow at 320 CSS px except genuine two-dimensional content such as tables; provide a usable alternative/detail view for dense tables. Sticky bars must not obscure focus.

## Navigation
App shell includes current organization/entity/branch context, authorized module navigation, global search, task inbox, help, notifications and profile. Show product/version/environment and a prominent demo badge. Tenant/organization switch clears scoped caches and unsaved-flow prompts. Entity switch updates date/currency/report context. Prefer task names such as Orders, Receiving and Payments over technical domain labels.

## Component requirements
| Component | Behavior and required states |
| --- | --- |
| Button | Primary/secondary/quiet/destructive; idle/hover/focus/pressed/loading/disabled; preserve accessible name and prevent duplicate command |
| Text / decimal field | Visible label, required marker, hint and linked error; locale-aware entry with canonical exact decimal serialization |
| Search / combobox | Keyboard navigation, explicit no-result/loading/denied states, reliable focus and selected value text |
| Date / period picker | Date-only behavior, fiscal context, keyboard entry; blocked periods explain why |
| Data table | Semantic headers, sorting state, named actions, selection summary, sticky context, totals, loading and empty state |
| Editable grid | Accessible cell editing and non-grid form alternative; precise validation, paste preview, save/conflict handling |
| Dialog / drawer | Named title, correct focus containment, escape policy, close confirmation for unsaved content, focus restoration |
| Tabs | Keyboard navigation and meaningful labels; errors/unsaved data do not vanish on tab change |
| Toast | Low-priority confirmation only; persistent errors/critical decisions remain in page context |
| Status badge | Text and optional icon; no color-only status; accounting and fulfillment displayed separately |
| Stepper | Completed/current/blocked meaning, resume point and link to evidence |
| File upload | Allowed type/size, progress, virus/quarantine status, retry/cancel and accessible error |
| Approval panel | Current approver, document revision, decision reason and history; unavailable action explains prerequisites |
| Chart | Units/date/basis/legend, accessible summary and data table, meaningful empty state |
| Command palette | Discoverable shortcut plus ordinary UI alternative; authorized results only |
| Dashboard widget | Metric definition, as-of watermark, filter scope, drill-through and accessible reposition controls |
| Timeline | Chronological events, actor/reason/source, protected sensitive changes |
| Workflow builder | Typed steps, simulation, validation and accessible list/tree editor alongside visual canvas |

## Tables and dense work
Comfortable rows 44-48 px; compact rows 32-36 px where users explicitly choose desktop density; touch actions 44 px preferred. WCAG 2.2 AA target minimum target size is 24x24 CSS px with criterion exceptions; our touch default is larger. Row click is not the only way to open a record. Selection persists only within a clearly defined query; show whether bulk action targets current page or all filtered records. Totals identify whether they cover selected, visible, filtered or entire population.

Virtualized grids require tested accessible navigation and a nonvirtual/paginated accessible mode if assistive technology cannot reliably read them. Keep column menus operable without dragging. Pin first identity column and essential totals where space permits. Currency and units remain visible; aggregate unrelated currencies only after an explicit conversion basis.

## Forms and financial documents
Group Basics, Lines, Terms, Accounting and Attachments. Default useful fields; advanced dimensions/tax override/FX remain discoverable. Show subtotal, discount, tax, withholding, freight, rounding, total and outstanding distinctly. Draft save is separate from submit/approve/post/pay. Posting confirmation includes entity, book, date, affected accounts and irreversible implications. Require confirmation based on consequence, not for every ordinary save.

Autosave can save drafts, never post or send money. Show Saved/Saving/Offline/Conflict truthfully. Avoid losing entered data on validation, role expiry or server errors. Inline errors + focusable summary. Before leaving, prompt only when data would be lost.

## Interaction and motion
Transitions 120-180 ms for local state, 180-240 ms for overlays; prefer opacity/translation with restrained distance. Respect reduced-motion preference. Long operations show phase/progress or asynchronous job status, not an indefinite spinner. Undo is offered only where actual reversal is valid; never call a posted-payment reversal Undo.

## Accessibility and learning
Target WCAG 2.2 AA: normal text >=4.5:1, large text >=3:1, non-text controls >=3:1 as applicable. Full keyboard access, visible unobscured focus, logical reading order, landmark regions, labels, accessible authentication, no drag-only operation, adjustable timeouts and meaningful error recovery. Colorblind-safe statuses. Screen-reader test with at least one Windows and one Apple/mobile combination relevant to shipped clients.

Guide first useful task through role-aware checklist and inline examples. Explain COA, GRNI, retention and FX in plain language next to the field. Help displays only enabled/authorized capabilities. Do not force an onboarding tour on every login; allow skip/resume/search. Urgent financial controls cannot be dismissed as cosmetic tips.

## UI quality gate
Inspect real screens with 200% zoom, keyboard-only, long party names, Urdu/RTL candidates, empty data, 10,000+ rows, negative values, mixed currencies, pending approvals, slow network, stale revisions and validation errors. Screenshot baselines for shared components and major workflows; manual task test catches problems screenshots miss. A token list alone does not establish pixel-perfect implementation. UX-SCREEN-SPECS.md defines reference screens and observable behavior.


## Implementation notes (web client, 2026-10-01)
How the rules above are implemented in `@omnysync/ui` and `apps/web`. Before and after screenshots are in `/workspace/erp-screens/{before,after,pos}`.

| Rule | Implementation |
| --- | --- |
| Navigation 240/64, top bar 56 | `App.tsx`: the sidebar collapses to 64 px through a top-bar toggle. The state is persisted in `localStorage` (`omnysync.nav.collapsed`) and collapses automatically below 1024 px. Collapsed items keep an accessible name through `aria-label`/`title`. The active item uses `aria-current="page"` plus a 3 px inset brand bar, so it is not shown by colour alone. Includes a skip link to `#main-content`. |
| Focus | Every interactive primitive uses `focus-visible` with a 2 px `#5B3CC4` ring or outline and a 1–2 px offset. Table rows that open detail are focusable and activate with Enter/Space. |
| Drawer instead of modal | `Drawer` (right side panel; sizes sm to 4xl) has a named title, a focus trap, Esc to close, focus restoration and a `dirty` discard confirmation. `Modal` is a deprecated alias (ADR-009). 45 modals were migrated across 19 views. |
| Combobox instead of select | `Combobox` supports typeahead search, grouping, keyboard navigation, and no-result, loading and denied states. Native `required` validation works through a hidden input. 60 selects were migrated. |
| Tables | `Table` has a sticky header inside a bounded scroll area (`max-h-[70vh]`), `scope="col"`, an optional caption, skeleton loading (`aria-busy`), an empty state (title, message, optional action) and an error state (`role="alert"` with retry). Right-aligned columns use tabular numerals. The load error is wired into 24 views; before this, a failed load looked like an empty table. |
| Forms | `Input` uses a `useId`-based id, a visible label, a required marker hidden from assistive tech, a hint or error linked through `aria-describedby`, and `aria-invalid`. Inline validation is used on the Automation drawers (rule schedule, JSON parameters, balanced recurring lines). |
| Feedback | `Alert` (info/success/warning/danger) is for persistent in-page messages. Danger and warning use `role="alert"`. |
| Radius, borders | Controls 6 px (`rounded-md`), surfaces and tables 10 px, drawers 12 px. Secondary buttons and inputs use `#7D8799` borders; `#D9DFEA` is used only for decorative dividers. |
| Type scale | Page titles 28/36, sections 20/28, body 14/20, table and supporting text 13/18. Nothing critical is below 11 px (sidebar group labels are 11 px uppercase, bold). |
| Money display | `apps/web/src/lib/format.ts` (`fmtMoney`, `fmtDec`, `fmtQty`, `sumDec`, `mulDec`) uses decimal.js HALF_UP. All 107 `parseFloat` display and arithmetic sites were replaced. `-0.00` is never shown. |
| Dates | The DB driver returns SQL `DATE` values as `YYYY-MM-DD` strings. Timestamps in the Automation console are shown in Asia/Karachi and labelled "PKT". |
| POS | This is a separate touch and keyboard layout (`apps/web/src/pos`). Targets are at least 44 px, there is a function-key tile bar, an F1 cheat sheet and a full-screen focus mode. All panels are Drawers. The shortcut map is in `pos/shortcuts.ts`. |
