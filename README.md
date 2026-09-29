# Moodle Test Action

Reusable GitHub Actions setup for Moodle plugin PHPUnit and optional Behat runs.

## Recommended Workflow

Use the central reusable workflow from plugin repositories:

```yaml
name: Moodle CI

on:
  pull_request:
    types: [ opened, reopened, synchronize ]
  push:
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

The reusable workflow uses the automatic resolver by default. No `automatic` input is needed:

```yaml
jobs:
  ci:
    uses: praxisdigital/moodle-test-action/.github/workflows/ci.yml@master
    secrets: inherit
    with:
      db_types: '["mysqli"]'
      # Optional: php_versions: '["8.3", "8.4"]'
      # Optional: products: '["moodle"]' or '["workplace"]' (default: both)
      # Keep db_types, dependencies and optional Behat/service settings as needed.
```

The automatic matrix comes from [the central target catalogue](.github/moodle-test-targets.json) and the plugin revision's `version.php`. Callers normally need only database types, dependencies and optional test/service settings. Set `automatic: 'false'` explicitly to use the legacy matrix and its one-off overrides.

Examples:

- [Basic workflow](.github/workflows/example.yml)
- [Workflow with static dependencies](.github/workflows/example-static-dependendies.yml)

## Defaults

With `automatic: 'false'`, the original matrix settings resolve in this order:

```text
workflow input -> repository/organization action variable -> built-in fallback
```

The legacy fallbacks remain Moodle 5.2, PHP 8.4, `moodle/moodle`, `ubuntu-latest`, MySQLi and non-experimental. `automatic: 'true'` ignores the legacy Moodle-ref, repository, runner, experimental and exclusion inputs/variables, including old org/repo PHP variables. It **still accepts an explicit `with: php_versions`** as an optional filter, plus `products: '["moodle"]'` or `products: '["workplace"]'` to run only one product. By default **both Moodle and Workplace run** on a `MOODLE_*` or `WORKPLACE_*` plugin branch. `db_types`, `dependencies`, Behat/PHPUnit controls and other service settings remain active. If the PHP filter has no compatible version for any selected target, setup fails instead of silently omitting that release.

## Automatic Moodle matrix

The central [JSON catalogue](.github/moodle-test-targets.json) defines available test targets. Moodle has 4.0–4.5 and 5.0–5.2; Workplace has 4.0–4.1, 4.3–4.5 and 5.0–5.2, using `WORKPLACE_*_LATEST` rather than numbered or rolling refs. Each entry couples a release, product, exact core repository/ref, `required` flag and inclusive `php_min`/`php_max` versions. All PHP minor versions between those bounds are tested; for example `8.2`–`8.4` generates 8.2, 8.3 and 8.4. Set `version_file: "public/version.php"` for core branches using Moodle's new `public/` layout (otherwise the root file is used). Update the catalogue once to add a newly applicable release (such as 5.3) or adjust its supported PHP range. The private Workplace fork's PHP support, refs and version-file paths still need verification with App access.

For a PR, setup reads `version.php` from the PR **merge ref** and uses the PR's base branch; for a push it uses that commit and branch. Plugin release branches partition **both products'** catalogues by version: `MOODLE_41_STABLE` owns releases from 4.1 up to (but not including) the next release branch in that plugin repository. The branch prefix is not a product restriction. `41`/`401` and `50`/`500` normalize to the same releases. Workplace `*_LATEST` branches are also recognized. The first branch-name segment must be at least four characters, so issue branches beginning `mma_`, `tk_`, or `abc_` do not create release boundaries. PRs into **any** branch still run. Both products require a readable core ref, so private Workplace tests need GitHub App access even when the plugin branch starts `MOODLE_`.

Within its branch range, the resolver tests the **first version compatible with the plugin's `version.php` for each product** (the baseline), even if that target has `required: false`. It also tests later compatible targets marked `required: true`. Optional intervening releases do not run. The current required milestones are 4.1, 4.5, 5.0 and 5.2; 4.0, 4.2, 4.3, 4.4 and 5.1 remain available as baselines. For example, a 5.1 plugin branch between 5.0 and 5.2 tests only 5.1, while a 4.1 branch followed by 4.5 tests only 4.1. Non-release branches use the same baseline-plus-required policy without a plugin-branch range.

The tested revision's `$plugin->requires`, `$plugin->supported` and `$plugin->incompatible` further filter the selection. Literal values are read without running plugin PHP. Core `version.php` is checked at each candidate ref to establish compatibility; the branch name does not override `version.php`. If no compatible target remains, setup fails. Without an explicit upper bound in plugin metadata, tests are the final check for compatibility with newer releases.

**One-off overrides remain available in legacy mode.** `with: moodle_versions`, `moodle_repositories`, `php_versions`, `os`, `experimental`, and `exclude_matrix` (or their existing `MOODLE_SUPPORTED_VERSIONS`, `MOODLE_REPOS`, `MOODLE_SUPPORTED_PHP_VERSIONS`, `MOODLE_OS`, `MOODLE_EXPERIMENTAL`, and `MOODLE_EXCLUDE_MATRIX` variables) retain their JSON-array format and Cartesian-product behavior. To test an unlisted version or an exceptional combination, set `automatic: 'false'` and supply the required overrides. Remove that input (or set it back to `'true'`) to use the catalogue regardless of old org/repo Moodle-ref and repository variables; there is no need to delete them. Database types and dependencies keep their previous inputs/variables in either mode.

Plugin component and install path are auto-detected from `$plugin->component` in `version.php`. Use `plugin_component` or `plugin_path` only for unusual plugins.

When using the root action, `action_ref` defaults to the same ref as `uses: praxisdigital/moodle-test-action@...`. The reusable workflow's `action_ref` defaults to `master`; when calling a development ref of `.github/workflows/ci.yml`, pass that same development ref as `action_ref` so setup checks out the matching resolver and catalogue.

## Behat

Behat runs when:

- `#behat` is posted on a pull request, review comment, or review body
- `workflow_dispatch` runs the workflow
- a push targets `main`, `master`, or a recognized release branch (`*_STABLE` or `*_LATEST`)
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

## Private repositories (GitHub App)

The reusable workflow mints an org-scoped GitHub App installation token for private Moodle forks and **private** plugin dependencies. Setup also uses this token to inspect private Workplace core refs when resolving the matrix. Public Moodle (`moodle/moodle`) and public plugin dependencies clone without the App.

Configure the App only when CI must read private repositories:

| Secret / var | Purpose |
| --- | --- |
| `MOODLE_CI_APP_ID` | Numeric GitHub App ID (secret or variable) |
| `MOODLE_CI_APP_PRIVATE_KEY` | App private key (**secret only**) |

Install the App on the org (`inputs.org` / `MOODLE_ORG` / repository owner) with at least **Contents: Read** on every private dependency and private Moodle fork CI must clone. Keep **Issues / Pull requests / Statuses** write if you rely on PR command comments or on-demand Behat statuses.

| Checkout target | App token required? |
| --- | --- |
| `moodle/moodle` (public) | No — uses `GITHUB_TOKEN` only |
| Other public Moodle/plugin repos | No — probed as public, cloned unauthenticated |
| Same-org private fork (e.g. `praxisdigital/moodle_workplace_moxis`) | Yes — App must include that repo with Contents: Read |
| Private plugin dependencies | Yes — same App install with Contents: Read |

When no App token is available, the workflow probes each Moodle repository and dependency with `GITHUB_TOKEN` via the GitHub API:

- **200 + `private: false`** — public; continue without the App
- **200 + `private: true`** — private and visible; fail with an App-token required message
- **404** — either private without access **or** the `org/repo` does not exist (GitHub does not distinguish these); fail with a message covering both cases
- **403 / other** — fail with access or lookup guidance

The reusable workflow requests an installation token scoped to:

- the current plugin repository
- the matrix Moodle repository when it lives under the App org
- each dependency repository under the App org

If token creation fails, the listed repos are almost always missing from the App installation (selected-repo install mode). Grant access to the private Moodle repo explicitly — plugin deps alone are not enough.

Private Moodle checkout also verifies the configured ref (`moodle` / `MOODLE_*_STABLE`) exists before `actions/checkout`.

Caller workflows should use `secrets: inherit` so the reusable workflow receives these credentials when private access is needed. Jobs fail fast only when a checkout target is not publicly cloneable and the App token cannot be created.

When calling the root or modular actions directly, mint the token in the caller job and pass it as `PRIVATE_REPO_TOKEN`.

## Notes

- PHPUnit supports `mysqli`, `pgsql`, and `sqlsrv`.
- Behat supports `mysqli` and `pgsql`.
- Dependencies use `org/repo@ref` format.
- `issue_comment` workflows must exist on the plugin repository default branch before `#behat` comments can trigger them.
