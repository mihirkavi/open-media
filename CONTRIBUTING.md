# Contributing to Open Media

Thank you for helping. Open Media is open source, and issues, ideas and pull requests from anyone are welcome.

## How changes reach `main`

`main` is the code that ships to people's phones, so it is protected:

- Only the maintainer (@mihirkavi), and the maintainer's own tools acting on that account, can push to `main`.
- Everyone else proposes changes through a pull request from a fork.
- Every pull request needs the maintainer's approval (see [.github/CODEOWNERS](.github/CODEOWNERS)).
- Force pushes and deletion of `main` are blocked for everyone without admin rights.
- Automated checks on pull requests from first-time contributors wait for the maintainer's approval before they run.

## Proposing a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Fork the repository and create a branch.
3. Follow the [README](README.md#for-developers) to run the app locally.
4. Keep the change focused, add or update tests, and run `npm run check` (plus `npm run test:db` for database changes).
5. Test on every platform your change can affect: web, iOS and Android. Say in the pull request which ones you tested and how.
6. Open a pull request that explains what changed and why.

## Ground rules

- Never commit real credentials, tokens, mailbox exports or personal messages.
- Keep claims honest: label mock or unfinished connectors clearly, and update the docs when behavior changes.
- Use official APIs and open protocols for other networks. No scraping.
- Major design choices get a short decision record in [docs/adrs](docs/adrs).

## Security issues

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
