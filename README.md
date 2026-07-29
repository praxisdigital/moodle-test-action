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
- uses: praxisdigital/moodle-test-action@master
  with:
    php: '8.4'
    moodle: 'MOODLE_502_STABLE'
    moodle_repository: 'moodle/moodle'
    dbtype: 'mysqli'
    dependencies: |
      praxisdigital/local_pxsdk@master
    action_ref: 'mma_BehatOnDemand'
    PRIVATE_REPO_TOKEN: ${{ secrets.MOODLE_GH_KEY }}
```

## Modular PHPUnit Usage

```yaml
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
    PRIVATE_REPO_TOKEN: ${{ secrets.MOODLE_GH_KEY }}
```

## Notes

- PHPUnit supports `mysqli`, `pgsql`, and `sqlsrv`.
- Behat supports `mysqli` and `pgsql`.
- Dependencies use `org/repo@ref` format.
- Private dependencies need `PRIVATE_REPO_TOKEN` or `MOODLE_GH_KEY` when using the reusable workflow.
- `issue_comment` workflows must exist on the plugin repository default branch before `#behat` comments can trigger them.
- If `GITHUB_TOKEN` cannot post comments or statuses, configure `MOODLE_CI_APP_ID` and `MOODLE_CI_APP_PRIVATE_KEY` for a GitHub App token.
