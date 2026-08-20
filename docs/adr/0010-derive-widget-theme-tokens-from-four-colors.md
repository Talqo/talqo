# 0010: Derive Widget Theme Tokens From Four Colors

## Status

Accepted (2026-08-19)

## Context

Operators must control the widget's appearance (FR-2.20) without picking the sixteen tokens it renders from, while NFR-4.2 still requires a working dark mode. Asking for two full palettes doubles the form and adds contrast pairs that can fail; computing a palette in JavaScript would duplicate color math CSS already provides.

## Decision

Derive every widget token in CSS from four operator inputs — `primary`, `primary-foreground`, `background`, `foreground` — using `color-mix()`, expressing the opposite scheme by swapping the background/foreground pair.

## Consequences

One palette yields both schemes, and derived contrast is bounded by the operator's own pairs, so the dashboard warns on those two rather than gating. Widget CSS may never use `@property` (the build strips it, then fails), and each mix must lead with the color that is its safe fallback: Tailwind's `@supports` guard falls back to the first argument.
