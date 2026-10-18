# Deep check data

Small files the Deep check model needs, used exactly as published
([ADR 0012](../../../docs/adr/0012-deep-check-ai-model.md)). The model itself
(361 MB) isn't here: `scripts/deep-check-files.ts` downloads it before each
build.

| File                  | What it is                                                     | From                                                                                                              | SHA-256 (first 12) |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| `vocab.json`          | The model's word pieces and their numbers (RoBERTa)            | [Meyssa/gector-large-2024](https://huggingface.co/Meyssa/gector-large-2024), commit `93faea4b7a13`, Apache-2.0     | `ed19656ea170`     |
| `merges.txt`          | How word pieces join, in order                                 | same                                                                                                              | `1ce1664773c5`     |
| `labels.txt`          | The model's 5,002 labels, in order                             | same                                                                                                              | `5afe93088eb6`     |
| `verb-form-vocab.txt` | Verb forms, for labels like `$TRANSFORM_VERB_VB_VBZ` (go → goes) | [grammarly/gector](https://github.com/grammarly/gector), `data/verb-form-vocab.txt`, Apache-2.0                  | `5906804ec8a1`     |

`fixtures/` holds test data made with the Python code that was measured on
real essays: the word pieces Hugging Face's tokenizer gives 731 words
(`bpe.json`), and 126 sentences with labels and the words they turn into
(`edits.json`). The unit tests check the app gives exactly the same.
