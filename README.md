# Open Media

**Post everywhere. Message everyone. One app.**

Open Media is a free, open-source app that brings your social life into one place. You read one feed, keep one inbox for every conversation, and publish one post to every network you choose. It runs on iPhone, Android and the web.

![Open Media artwork](assets/brand/cover.png)

## The problem

Your online life is split across a dozen apps. Friends are on one, colleagues on another, family on a third, and email sits off to the side. Each app decides what you see with a hidden algorithm built to keep you scrolling. Each app also owns your followers, your posts and your history. Leave the app, and you start from zero.

People did not choose this. It is the default because every app wants to be the only one you use.

## What Open Media does

Open Media is built around three simple promises.

1. **Everything together.** One place for your social world. Posts from several networks appear in one feed, and your chats and email appear in one list, organized by person rather than by app.
2. **Your feed belongs to you.** You pick how your feed is sorted. *Raw* is simply newest first. *Relevant* uses a few signals that you can see, and every ranked post has a "Why this?" button that explains why it is there.
3. **You are not locked in.** Your identity, audience and content should move with you. You can export your data or delete your account at any time, and the long-term plan is for all of it to be portable between apps.

Open Media is useful on day one, even if none of your friends use it yet, because it connects to the networks and inboxes you already have.

## Why now

- **Open social networks are real now.** Farcaster, Lens, Hive and DeSo let any app read and publish posts without asking a gatekeeper for permission. Open Media reads all four today.
- **People want control over their feeds.** Frustration with opaque, engagement-driven algorithms is widespread, and new rules in several regions push platforms toward transparency and data portability.
- **AI agents need open data.** Assistants such as ChatGPT and Claude increasingly act on people's behalf. Open Media publishes its public posts through an open API, and its event planner works inside these assistants.

## What you can do today

Open Media is in **public beta**. These features work in the current code:

| Area | What you can do |
| --- | --- |
| **Feed** | Read posts from Open Media, Farcaster, Lens, Hive and DeSo in one stream. Switch between Raw and Relevant. Anyone can read public posts without an account. |
| **Clips** | Swipe through short videos from the same networks, full screen, one at a time. |
| **Post** | Write a post or upload a short video once, and share it to the open networks you have connected. You never hand over a seed phrase or master key. |
| **Messages** | Chat with other Open Media users. Connect any email account and read or reply to your email as conversations. Optionally bridge WhatsApp and other chat apps into the same inbox. |
| **Search** | Search posts, your messages, your email and every setting from one box, in plain language. Private data is searched on your device. |
| **Privacy** | Export all your data or delete your account from your profile. Messages, email and contacts stay private; only the posts you publish are public. |
| **Events** | Ask an AI assistant to find events, check your calendar and plan your week through the Open Media Events service. |

Some features still need setup or real-world testing before they work for everyone. The [technical overview](docs/TECHNICAL_OVERVIEW.md) lists exactly what has and has not been tested.

## How it is different

| | Big social apps | Inbox and feed aggregators | **Open Media** |
| --- | --- | --- | --- |
| Shows other networks | No | Some | Yes, through official APIs and open protocols |
| You choose the algorithm | No | Rarely | Yes, with "Why this?" on every ranked post |
| You can leave with your data | Partly | Partly | Full export and account deletion today; portable identity is the goal |
| Source code | Closed | Usually closed | Open source (MIT) |
| Public posts open to everyone | No | No | Yes, readable by anyone, including AI agents, through a free API |

## Where we are going

**Mission:** build the open communication layer for humanity, where people can talk across networks, control how information reaches them and keep ownership of their identity, relationships and content, whichever app they use.

The guiding idea is simple: **apps are doorways, and the person is the constant.** No single app should permanently own your identity, audience, posts, feed or message history. Open Media is one doorway. Over time, anyone should be able to build another doorway on the same open protocol, and the system should keep working even if the original company disappears.

The road ahead, roughly in order:

1. A simple, polished app with Feed, Clips and Messages (here now, in beta).
2. Posting to more networks and connecting more inboxes, through official APIs.
3. A marketplace of feed algorithms and moderation filters that you can switch on and off.
4. Optional proof that you are a real person, without storing ID documents or biometrics.
5. Portable, verifiable identity and content, and a gradual move to community-run infrastructure and governance.

Some things will never be the default: ranking your feed on your private messages, precise location or sensitive traits; requiring a crypto wallet; or optimizing for addiction.

The full vision, principles and phased plan are in the [Master Builder Prompt](Open%20Media%20%E2%80%94%20Master%20Builder%20Prompt.md), with a shorter public summary in [docs/MASTER_BUILDER_PROMPT.md](docs/MASTER_BUILDER_PROMPT.md).

## Honest status

Open Media is an early beta built in the open. To be clear about what it is not yet:

- It cannot read your Instagram, X, LinkedIn or TikTok feeds, and it cannot post to them. Those companies do not offer open access, and Open Media does not scrape them.
- Chat bridges for WhatsApp and similar apps are optional and come with a warning: those companies do not approve them, and accounts could be limited.
- Video is stored as uploaded, without streaming optimization, and posting to some networks has not yet been tested against a live account.
- Messages between Open Media users are protected by the database and access rules, but they are **not** end-to-end encrypted yet.

The complete, regularly updated list is in the [technical overview](docs/TECHNICAL_OVERVIEW.md#honest-limitations).

## For developers

Open Media is one TypeScript codebase (Expo and React Native) for iOS, Android and the web, backed by Supabase and a Cloudflare Worker.

Requirements: Node.js 22.13+ (`nvm use`), npm and Docker Desktop. Xcode or Android Studio only for native simulators.

```bash
npm install
npm run local
```

This starts the database, sign-in, mail service, public API and web app on your computer and opens <http://localhost:8081>. Sign-in codes go to a local test inbox and are filled in automatically. `npm run local:stop` stops the database.

Other targets:

```bash
npm run ios
npm run android
npm run web
```

Before sending a change, run the checks:

```bash
npm run check
npm run test:db # requires the local Supabase stack
```

Learn more:

- [Technical overview](docs/TECHNICAL_OVERVIEW.md): every feature, the architecture, configuration and limitations
- [Public API](services/mail-sync/PUBLIC_API.md): read Open Media posts and profiles as JSON
- [Architecture decisions](docs/adrs): the short records behind each major choice
- [Open Media Events](docs/events/README.md): the event-planning service for AI assistants
- [Production readiness](docs/PRODUCTION_READINESS.md) and the [migration plan](docs/OPEN_MEDIA_MIGRATION.md)

## Contributing

Everyone is welcome to open issues and pull requests. The `main` branch is protected: only the maintainer can merge, and every outside change is reviewed first. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change and [SECURITY.md](SECURITY.md) for reporting a vulnerability privately.

## License

MIT. See [LICENSE](LICENSE). Project artwork is conceptual; see [assets/brand](assets/brand/README.md) for the files and how they were made.
