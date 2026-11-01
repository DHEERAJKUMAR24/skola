# 0004. Email and password accounts, OTP reset, no passkeys

Date: 2026-11-01
Status: Accepted

## Context
Owner wants simple, self-hosted accounts.

## Decision
Auth.js Credentials with scrypt, lockout after 5 failures, password reset through an emailed 6-digit OTP (Resend). No passkeys.

## Consequences
No email verification at sign-up and no per-IP rate limiting yet (tracked in SPEC risks).
