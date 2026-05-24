# Provider Adapters

V-Board is provider-neutral at the core. Operators can choose their own LLM, voice, speech-to-text, avatar, bank, and observability providers.

## LLM Router

The preferred production path is an chat-completions-compatible router exposed through:

- `LLM_ROUTER_API_KEY`
- `LLM_ROUTER_API_BASE_URL`

Meeting-room council calls can also use role-specific URLs:

- `PRIMARY_LLM_API_KEY`, `PRIMARY_LLM_API_BASE_URL`
- `REVIEWER_LLM_API_KEY`, `REVIEWER_LLM_API_BASE_URL`
- `CHAIR_LLM_API_KEY`, `CHAIR_LLM_API_BASE_URL`

## Direct SDK Mode

Some operators prefer a provider SDK. Meeting-room intervention fallback supports configurable SDK imports:

- `PRIMARY_LLM_SDK_MODULE`
- `PRIMARY_LLM_SDK_CLIENT`

Speech-to-text SDK mode uses:

- `STT_API_KEY`
- `STT_SDK_MODULE`
- `STT_SDK_CLIENT`
- `STT_MODEL`

## Voice

Voice synthesis is configured with:

- `VOICE_API_KEY`
- `VOICE_API_BASE_URL`
- `VOICE_API_KEY_HEADER`
- `MEETING_VOICE_CFO`
- `MEETING_VOICE_CTO`
- `MEETING_VOICE_COO`
- `MEETING_VOICE_CRM`
- `MEETING_VOICE_LEGAL`
- `MEETING_VOICE_PRODUCT`
- `MEETING_VOICE_CHAIR`

The default voice IDs are generic aliases. Operators map them to real provider voice IDs in environment variables.

## Avatar

Avatar support is optional and request-scoped BYOK is supported.

- `AVATAR_API_KEY`
- `AVATAR_API_BASE_URL`

Rules:

- HTTPS is required.
- Meeting tokens are never exposed in room status.
- Provider errors are redacted.

## Bank Data

The finance/CFO stack expects normalized bank context and validation artifacts. A live bank adapter can be configured with:

- `BANK_API_AUTH`
- `BANK_API_LOGIN`
- `BANK_API_SECRET`

The CFO stack must fail closed unless bank validation is present and consistent.

## Adapter Checklist

Before adding a provider adapter:

- Keep the core generic.
- Add env examples without real provider secrets.
- Add timeout and redaction behavior.
- Add no-key tests with mocked provider calls.
- Document cost and safety assumptions.
- Never commit provider-specific credentials, account IDs, server IPs, or private organization names.