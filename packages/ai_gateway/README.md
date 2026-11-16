# AI Gateway

Provider adapter boundary for OpenAI, Anthropic Claude, Google Gemini and future providers.

Target contract:
- generate(request, policy) -> GenerationResult
- stream(request, policy) -> AsyncIterator[GenerationChunk]
- count_tokens(request, provider, model), where supported
- list_models(provider) with cached capability metadata

Normalize authentication, rate-limit, timeout, unavailable and invalid-request errors. Record tenant, request ID, provider, model, latency, token usage and estimated cost. Capability-gate tool calling, structured output, multimodal input, caching and streaming. Preserve native provider APIs when compatibility layers lack feature parity.
