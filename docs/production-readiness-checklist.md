# Production Readiness Checklist

Use this before adding major features, backend, payments, or public release.

## 1. Platform And Cloud

- Where does the app run?
- Which platforms are supported first?
- Is the backend managed or self-hosted?
- What environments exist: local, staging, production?
- How are mobile builds distributed?

Current decisions:

- Android first.
- Expo + React Native app.
- Supabase managed backend.
- Expo Go for development.
- EAS Build for installable Android builds.
- Private APK/testing link first.
- Google Play internal testing later.
- One beta environment now; staging and production before wider launch.

## 2. Application Architecture

- What is the repo structure?
- Where does each type of logic live?
- What is the API style?
- What code is shared between client and backend?
- What must stay pure and testable?

## 3. Data And Persistence

- What tables exist?
- What IDs, timestamps, and ownership fields are required?
- What is stored locally vs remotely?
- What RLS policies protect each table?
- What backup policy exists?

Current decisions:

- Supabase Postgres stores rooms, players, rounds, answers, votes, scores, reports, categories, and category packs.
- Anonymous players need temporary device-saved IDs for rejoin.
- Completed guest-room history is retained for 15 days.
- Paid-user history is retained longer.
- Room results are shareable after the game ends.
- Reported answers are saved for moderation review.

## 4. Scale And Performance

- How many users/rooms must MVP support?
- What actions need realtime speed?
- What should be cached?
- What background work exists?
- What are acceptable latency targets?

Current decisions:

- Private beta target: 10 active rooms.
- Per-room limit: 8 players and 20 spectators.
- Auto-submit typed answers when timer ends.
- Brief grace period for poor internet.
- Balance fast gameplay with not leaving players behind.

## 5. Security

- How can the app be abused?
- What permissions exist?
- What is authorized server-side?
- What input is validated?
- Where are secrets stored?
- What actions need rate limits?

Current decisions:

- Use short secure-readable room codes like `A7KQ9Z`.
- No display-name changes after joining.
- Submitted answers are locked.
- UI auto-submits at timer end.
- Server still rejects late submissions.
- Rate-limit room creation: 3/hour free, 10/hour paid.

## 6. Payments

- Does money move in MVP?
- What payment provider is used?
- Are purchases one-off, subscription, or ads?
- How are refunds handled?
- How are VAT/tax and purchase restore handled?

## 7. Compliance And Data Protection

- What personal data is collected?
- What laws apply?
- Can users delete/export their data?
- Where is data stored?
- Which third parties process data?
- Is there a privacy policy?

Current decisions:

- Users can request deletion once accounts exist.
- Users can export game history later.
- Minimum age: 13+.
- Reported/offensive answers are retained longer for moderation evidence.
- Analytics are anonymous by default.

## 8. Observability

- Can we see errors?
- Can we see crashes?
- Can we see failed backend writes?
- Can we monitor uptime?
- What dashboards exist?
- What alerts exist?

Current decisions:

- Track basic anonymous events.
- Add crash/error reporting before private beta.
- Add admin dashboard later for rooms, reports, abuse strikes, and usage.
- Track game-flow drop-off.
- Show friendly beta errors with report codes.

## 9. Testing And Quality

- What unit tests are required?
- What integration tests are required?
- What manual test plan exists?
- What security tests are needed?
- What load tests are needed?
- What devices must be tested?

Current decisions:

- Add automated scoring tests before backend work continues.
- Add room-flow tests where practical.
- Manually test on Android phone before each major milestone.
- Test weak internet/reconnect before private beta.
- Beta quality target: usable but rough.

## 10. CI/CD And Branching

- What branch strategy is used?
- What checks run before merge?
- How are preview builds created?
- How are database migrations shipped?
- How are releases rolled back?

Current decisions:

- Typecheck and tests before calling changes done.
- One main branch for now.
- Database changes via migration files, not manual dashboard edits.
- Preview/test builds before tester APKs.
- Changelog for each beta build.

## 11. Reliability And Operations

- What happens when the backend is down?
- What happens when realtime disconnects?
- What is the backup and restore plan?
- What is the incident process?
- What uptime target applies?

Current decisions:

- Pause briefly on realtime disconnect.
- Use 5-10 second reconnect grace for beta.
- Show friendly offline/error screen if Supabase is down.
- Back up database before public launch.
- Provide beta feedback/bug-report path.
- Rollback quickly if a release is broken.

## 12. Launch Readiness

- Is the MVP scope frozen?
- Are analytics and crash logs working?
- Are legal pages ready?
- Is store listing content ready?
- Is there a support contact?
- Is there a beta feedback loop?
