---
version: alpha
name: R2Cloud — Open Day
description: A warm, visual product workspace with soft colors and a clear review journey.
colors:
  canvas: "#F8F7F4"
  surface: "#FFFFFF"
  surface-muted: "#F0EFEC"
  text-primary: "#35333E"
  text-secondary: "#686572"
  border: "#D9D7D2"
  primary: "#75608F"
  accent-hover: "#634E7C"
  accent-soft: "#EEEAF6"
  on-accent: "#FFFFFF"
  todo-soft: "#EEF3FA"
  todo-ink: "#526886"
  ongoing-soft: "#FBEEE2"
  ongoing-ink: "#8B6239"
  completed-soft: "#ECF3EB"
  completed-ink: "#52715B"
  danger-soft: "#F9E7E6"
  danger-ink: "#A34442"
  focus: "#67508A"
typography:
  title:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: -0.04em
  heading:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: 550
    lineHeight: 1.5
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 450
    lineHeight: 1.5
rounded:
  control: 12px
  card: 14px
  panel: 24px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  section: 32px
components:
  workspace:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-primary}"
  sidebar:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-secondary}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-primary}"
  separator:
    backgroundColor: "{colors.border}"
  focus-ring:
    backgroundColor: "{colors.focus}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  selected-navigation:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.primary}"
  todo-column:
    backgroundColor: "{colors.todo-soft}"
    textColor: "{colors.todo-ink}"
  ongoing-column:
    backgroundColor: "{colors.ongoing-soft}"
    textColor: "{colors.ongoing-ink}"
  completed-column:
    backgroundColor: "{colors.completed-soft}"
    textColor: "{colors.completed-ink}"
  error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-ink}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: 12px
  task-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: 16px
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: 24px
---

## Overview

A calm, inviting worktable for ideas becoming working products. Warm paper, soft blue, apricot and sage board surfaces, and a muted plum action color. Rounded, well-spaced components provide the character. The interface feels approachable without becoming childish or ornamental.

This is a fresh frontend following the user's latest brief. The first supplied sketch defines the three-column board, participants and broad composer. The second supplied image informs organisation/project navigation hierarchy only; it is not a visual reference.

## Colors

The canvas is warm rather than stark white. White cards sit on low-chroma column surfaces. Blue identifies Todo, apricot Ongoing, and sage Completed; labels and symbols repeat every meaning. Plum is the action accent. Error red is reserved for blocked/error information.

Use semantic CSS tokens from `apps/web/src/design/tokens.css`. Measure actual foreground/background pairs. Body text and normal controls require 4.5:1; focus indicators require 3:1 against adjacent surfaces. Decorative pale borders do not carry control identity alone.

## Typography

Self-host **Plus Jakarta Sans Variable**, with a system sans fallback. Its rounded counters and clear small-size forms suit an approachable product tool. Use 400–650 weights, a short type scale, sentence case and restrained negative tracking on titles only. Keep editable inputs at 16px on touch screens. Branches and digests may use the system monospace stack inside advanced details.

## Layout

A collapsible 232px organisation/project sidebar anchors the left. The content area has a compact context bar, a project heading, useful board controls, three equal columns and a broad bottom composer. Keep the board visually dominant. No dashboard metrics or decorative marketing sections.

At narrow widths, the sidebar becomes a modal sheet and a three-way column selector shows one board column at a time. Every action remains available at 320px without page overflow. Task review opens in a separate modal side panel with Overview, Conversation and Activity views. Context stays visible without showing all information at once.

Use shared alignment edges. Gaps between groups exceed gaps within a group. Cards show title, priority, ownership, agent identity and progress; the full outcome belongs in task details.

## Elevation & Depth

Use subtle neutral ring-and-lift shadows on white cards. Space and surface colors group content before separators. Drawers and popovers get one quiet elevation step. Following the later button reference, primary and secondary actions have a restrained neumorphic treatment: an inset upper highlight, a darker lower lip, and a soft raised shadow. Pressing sinks the surface into an inset shadow. Keep clear boundaries and text contrast; do not blur controls into their background. Avoid gradients, glass, glowing edges, heavy borders and decorative shadows.

## Shapes

Controls use 12px corners; task cards use 14px. Board containers use 24px corners around a 10px inset, keeping nested curves concentric. Avatars are circular and status labels are pills. Do not put every text fragment in a badge.

## Components

Use **Hugeicons Stroke Rounded** exclusively, rendered by a shared Icon component, usually at 18–20px with 1.8 stroke. Icons accompany meaning rather than fill space. Every icon-only control has an accessible name and at least a 40px target; use 44px on touch.

Primary actions name their result: Start work, Try the preview, Request changes, Publish changes for code review. Publication and merge have separate, exact-candidate confirmations. Simulated external work remains visibly labelled as a local fixture.

Use native buttons, inputs, selects, details and modal dialogs. Move and restore focus; the modal background is inert. Empty states have one relevant next action. Errors stay visible until dismissed and say how to recover.

Emil's motion guidance applies: frequent board actions are immediate. Pointer presses sink 1px and scale to 0.98 for 120ms. Cards lift 1px on pointer hover. Dialogs, the sidebar, and review drawers enter over 180ms with a strong ease-out. A loading icon rotates only while an operation is pending. Keyboard navigation and reduced-motion users get no movement. Never animate all properties.

## Do's and Don'ts

- Keep the board easy to scan and the composer scope explicit.
- Prefer a short label, good spacing and a clear visual state over explanatory paragraphs.
- Preserve readable contrast on the soft surfaces.
- Show test evidence, limitations and approval scope where a reviewer needs them.
- Keep technical information behind a labelled disclosure.
- Never present an open PR as deployment or completion.
- Never use a fake live preview, fake participant presence, decorative metrics, or disabled controls for unimplemented product features.
- Do not reuse the previous dark frontend styling or derive aesthetics from the second attachment.

The format follows Google's DESIGN.md specification. Engineering guidance is informed by the pinned Emil and Jakub skills recorded in `docs/DESIGN-SOURCES.md`.
