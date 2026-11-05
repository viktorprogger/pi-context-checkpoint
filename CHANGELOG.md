# Changelog

## [0.3.2] - 2026-11-05

### Fixed

- Manual `/checkpoint` now shows checkpoint progress without automatically starting a continuation, while agent-invoked checkpoints retain automatic continuation.

## [0.3.1] - 2026-11-02

### Changed

- Strengthened checkpoint resumption prompts to preserve current user scope and explicit non-goals, distinguish superseded plans from current decisions, make clarification, approval, and wait gates explicit, and distinguish delegated-work reports from independent verification.
- Isolated checkpoint lifecycle tests from the host's global checkpoint-model settings by using a temporary Pi agent configuration directory.
