# .github

GitHub configuration for Open Media.

- `CODEOWNERS`: makes the maintainer (@mihirkavi) the required reviewer for every file.

The protection itself lives in GitHub, not in this folder: a repository ruleset named "Protect main" blocks force pushes and deletion of `main` and requires a reviewed pull request for everyone except repository admins. See [CONTRIBUTING.md](../CONTRIBUTING.md).

Notes for agents: do not add workflows that run on `pull_request_target` or that receive secrets on pull requests from forks.
