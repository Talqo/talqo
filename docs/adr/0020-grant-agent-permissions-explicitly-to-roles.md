# 0020: Grant agent permissions explicitly to roles

## Status

Accepted (2026-10-20)

## Context

A role-agent membership table keeps storage small but gives a role the same capabilities on every assigned agent, forcing extra roles for exceptions. Discord-style overrides support exceptions but introduce inheritance and conflicting allows and denies. Operators need different responsibilities on different agents without learning precedence rules.

## Decision

Grant capabilities explicitly to roles on each agent, combine roles additively, and keep deployment administration global.

## Consequences

Agent access can be configured where operators manage the agent without duplicating roles or adding override resolution. All resource reads and writes must respect agent scope, including analytics and conversations. Access-management bounds extend to role membership and account recovery. Global agent permissions are removed without compatibility grants; admin retains recovery access and alone creates agents.
