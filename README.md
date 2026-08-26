# Moodle Test Action

Reusable GitHub Actions setup for Moodle plugin PHPUnit and optional Behat runs.

## Recommended Workflow

Use the central reusable workflow from plugin repositories:

```yaml
name: Moodle CI

on:
  pull_request:
    branches:
      - main
      - master
      - MOODLE_*_STABLE
  push:
    branches:
      - main
      - master
      - MOODLE_*_STABLE
  issue_comment:
    types: [created]
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  pull-requests: write
  issues: write
  statuses: write

jobs:
  ci:
    uses: praxisdigital/moodle-test-action/.github/workflows/ci.yml@master
    secrets: inherit
```

Examples:

- [Basic workflow](.github/workflows/example.yml)
- [Workflow with static dependencies](.github/workflows/example-static-dependendies.yml)

## Defaults

The central workflow resolves settings in this order:

```text
workflow input -> repository/organization action variable -> built-in fallback
```

Useful optional overrides:

```yaml
with:
  action_ref: 'custom_test_branch'
  moodle_versions: '["MOODLE_405_STABLE"]'
  php_versions: '["8.3"]'
  db_types: '["mysqli"]'
  moodle_repositories: '["moodle/moodle"]'
  dependencies: '["praxisdigital/local_pxsdk@master"]'
  additional_phpunit_arguments: '--filter SomeTest'
```

Plugin component and install path are auto-detected from `$plugin->component` in `version.php`. Use `plugin_component` or `plugin_path` only for unusual plugins.

When using the root action, `action_ref` defaults to the same ref as `uses: praxisdigital/moodle-test-action@...`. Override it only when the wrapper and subactions should come from different refs.

## Behat

Behat runs when:

- `#behat` is posted on a pull request, review comment, or review body
- `workflow_dispatch` runs the workflow
- a push targets `main`, `master`, or `MOODLE_*_STABLE`
- `behat_on_pull_request: 'true'` is set for normal pull requests

Tagged Behat runs are supported:

```text
#behat @javascript
#behat @javascript @block_example
```

Only tags matching `@[A-Za-z0-9_-]+` are accepted. Multiple tags are passed as an OR expression.

If no `tests/behat/*.feature` files exist, the Behat job exits successfully and can optionally comment on the PR with `post_no_tests_comment: 'true'`.

## Root Action Usage

The root action is a compatibility wrapper. It runs PHPUnit by default and Behat only when `run_behat: 'true'` is set.

```yaml
- uses: actions/create-github-app-token@v2
  id: app-token
  with:
    app-id: ${{ secrets.MOODLE_CI_APP_ID }}
    private-key: ${{ secrets.MOODLE_CI_APP_PRIVATE_KEY }}
    owner: praxisdigital
    permission-contents: read
- uses: praxisdigital/moodle-test-action@master
  with:
    php: '8.4'
    moodle: 'MOODLE_502_STABLE'
    moodle_repository: 'moodle/moodle'
    dbtype: 'mysqli'
    dependencies: |
      praxisdigital/local_pxsdk@master
    action_ref: 'mma_BehatOnDemand'
    PRIVATE_REPO_TOKEN: ${{ steps.app-token.outputs.token }}
```

## Modular PHPUnit Usage

```yaml
- uses: actions/create-github-app-token@v2
  id: app-token
  with:
    app-id: ${{ secrets.MOODLE_CI_APP_ID }}
    private-key: ${{ secrets.MOODLE_CI_APP_PRIVATE_KEY }}
    owner: praxisdigital
    permission-contents: read
- uses: praxisdigital/moodle-test-action/phpunit-test@master
  with:
    plugin: 'local_pxsdk'
    plugin-path: 'local/pxsdk'
    php: '8.4'
    moodle: 'MOODLE_502_STABLE'
    moodle_repository: 'moodle/moodle'
    os: 'ubuntu-latest'
    dbtype: 'mysqli'
    dependencies: ${{ vars.MOODLE_PLUGIN_DEPENDENCIES || '' }}
    PRIVATE_REPO_TOKEN: ${{ steps.app-token.outputs.token }}
```

## Private repositories (GitHub App)

The reusable workflow mints an org-scoped GitHub App installation token for private Moodle forks and plugin dependencies. Configure:

| Secret / var | Purpose |
| --- | --- |
| `MOODLE_CI_APP_ID` | Numeric GitHub App ID (secret or variable) |
| `MOODLE_CI_APP_PRIVATE_KEY` | App private key (**secret only**) |

Install the App on the org (`inputs.org` / `MOODLE_ORG` / repository owner) with at least **Contents: Read** on every private dependency (and private Moodle) repo CI must clone. Keep **Issues / Pull requests / Statuses** write if you rely on PR command comments or on-demand Behat statuses.

Caller workflows should use `secrets: inherit` so the reusable workflow receives these credentials. Jobs with private `dependencies` fail fast if the App token cannot be created.

When calling the root or modular actions directly, mint the token in the caller job and pass it as `PRIVATE_REPO_TOKEN`.

## Notes

- PHPUnit supports `mysqli`, `pgsql`, and `sqlsrv`.
- Behat supports `mysqli` and `pgsql`.
- Dependencies use `org/repo@ref` format.
- `issue_comment` workflows must exist on the plugin repository default branch before `#behat` comments can trigger them.
