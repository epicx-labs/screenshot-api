# Screenshot API Domain

**Clean Screenshot**:
A stable viewport screenshot captured after common blockers are removed,
near-viewport lazy media is prepared, animations are disabled, and videos are
paused.

**Blocker**:
A consent banner, modal, popup, gate, or sticky overlay that hides meaningful
page content.

**Lazy Media Preparation**:
A viewport and near-fold scroll pass that encourages lazy images, videos, and
embeds to render before capture.

## Rules

- `POST /screenshots` preserves its existing public request and response shape.
- Desktop capture is always returned; mobile capture is opt-in.
- Every viewport runs the clean screenshot pipeline independently.
- Cleanup is best-effort and must not fail an otherwise valid capture.
- The service exposes no crawler or audit endpoints.
