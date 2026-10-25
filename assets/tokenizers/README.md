# Offline tokenizer provenance

Only tokenizer data and code are included; no model weights or network requests are needed at runtime.

| Component | Pinned source | License |
| --- | --- | --- |
| Tokenizer engine | [Hugging Face tokenizers.js](https://github.com/huggingface/tokenizers.js), npm `@huggingface/tokenizers@0.2.0` | Apache-2.0, `src/rp/tokenizers/vendor/LICENSE` |
| DeepSeek-V3.2 vocabulary and configuration | [official repository at a7e62ac04ecb2c0a54d736dc46601c5606cf10a6](https://huggingface.co/deepseek-ai/DeepSeek-V3.2/tree/a7e62ac04ecb2c0a54d736dc46601c5606cf10a6) | MIT, `deepseek-v3.2/LICENSE` |

Files are retained unchanged from the pinned artifacts. The small TypeScript declaration facade is this project's own integration code. SHA-256:

- vendor `tokenizers.mjs`: `1c4a848f86156201c033d6cd08c4cf81ae1088552acec3367f31ef086edf5af0`
- `tokenizer.json`: `cd050be35cae877f8f0aa847f45aa87e23835a56ca32b29b28545597852784e5`
- `tokenizer_config.json`: `b5de6cc1c6758d02c0d3cec0efa062f1161654475458003f6f293f6ef28acdaa`

Runtime checks both data hashes and caches one lazy instance. Missing or modified files fail closed for an explicit exact-model binding. The loader does not silently replace it with another tokenizer.

The 23 vectors in `test/fixtures/tokenizers/deepseek-v3.2.json` were generated independently with Hugging Face's Rust-backed Python `tokenizers==0.22.2`, `Tokenizer.from_file`, `add_special_tokens=False`. The development probe compared every token ID with the JavaScript implementation, including Chinese, English, emoji, whitespace, combining characters, special-token spellings and long text. The checked-in regression tests compare token counts against those fixed vectors. No model call was made.

This establishes the supported text encoding for these fixtures, not universal support for all tokenizer configurations, hidden provider templates, or changing API aliases. See [budget behavior and limits](../../docs/memory-budget.zh.md).
