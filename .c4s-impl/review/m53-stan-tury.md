# Review m53-stan-tury

- Round 1: **rev-0001** (blocking, fixed) `src/client/chat/ChatOverlay.tsx:379` — long-history window batched every message per delta; now only the visible slice.
- Round 1: **rev-0002** (blocking, fixed) `src/client/chat/ChatOverlay.tsx:391` — window counted from the newest message (new messages re-hid revealed ones; stale window on thread switch); now a pinned start index reset per thread before render.
- Round 2: no findings.
