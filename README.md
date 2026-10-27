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
    branches: [main, master, '*_STABLE', '*_LATEST']
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

Restrict `push` to the branches that need post-merge CI; pull requests already run CI on each new commit. An unrestricted `push` trigger also starts a separate workflow run for every commit to an open PR branch. The reusable workflow has one `setup` job followed by the test matrix and does not create a skipped push-gate check on PRs. Adjust the branch patterns to match your protected/default branches. If a branch matching the `push` filter is itself used as a PR head, GitHub still starts both events; exclude such branches from `push` if they must have only one run.

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

- [Basic workflow](examples/ci.yml)
- [Workflow with static dependencies](examples/ci-with-dependencies.yml)

These are templates, not active workflows in this repository. Only
[`validate-resolver.yml`](.github/workflows/validate-resolver.yml) runs here; on
pull requests, pushes to `master`, or manual dispatch it runs `npm test` and
checks workflow syntax with a pinned `actionlint` binary.

## Configuration and precedence

Set organization variables in **Organization Settings → Secrets and variables → Actions → Variables**, or repository variables in the equivalent **Repository Settings** page. Use the names below (for example, `MOODLE_PRODUCTS`), with the value shown as plain text; do not wrap the entire JSON value in extra quotes in the settings page. GitHub gives a repository variable precedence over an organization variable with the same name. For normal PR, push and manual runs, an explicit caller `with:` input takes precedence over the resolved variable; an empty input falls back to the variable, then to the built-in default. This section describes the reusable workflow called from a plugin repository's `.github/workflows/ci.yml`; the [root action](#root-action-usage) is configured separately. Variables do not change the caller's `on:` triggers or `runs-on` directly.

For example, set organization variable `MOODLE_PRODUCTS` to `["workplace"]` for Workplace-only automatic tests. A repository can override it with `["moodle"]`, and this caller overrides either variable:

```yaml
jobs:
  ci:
    uses: praxisdigital/moodle-test-action/.github/workflows/ci.yml@master
    secrets: inherit
    with:
      products: '["moodle", "workplace"]'
      db_types: '["mysqli", "pgsql"]'
```

### Inputs with organization/repository variable fallbacks

| Caller `with:` input | Actions variable | Applies to | Value and default when unset |
| --- | --- | --- | --- |
| `products` | `MOODLE_PRODUCTS` | Automatic only | JSON array of `["moodle"]` and/or `["workplace"]`; empty/unset selects **both**. An invalid or empty JSON array fails setup. |
| `db_types` | `MOODLE_DB_TYPES` | Both modes | JSON array of `"mysqli"`, `"pgsql"`, and/or `"sqlsrv"`; default `["mysqli"]`. PHPUnit supports all three; Behat rows for `sqlsrv` are skipped. |
| `dependencies` | `MOODLE_PLUGIN_DEPENDENCIES` | Both modes | JSON array of `"org/repo@ref"` strings (or whitespace-separated entries); default none. |
| `php_versions` | `MOODLE_SUPPORTED_PHP_VERSIONS` | **Input:** both modes. **Variable:** legacy only. | JSON array such as `["8.3", "8.4"]`. Automatic mode uses **only an explicit input** as an optional filter on each catalogue target; without it, all supported PHP versions run. Legacy default `["8.4"]`. |
| `moodle_versions` | `MOODLE_SUPPORTED_VERSIONS` | Legacy only | JSON refs, e.g. `["MOODLE_502_STABLE"]`; default `["MOODLE_502_STABLE"]`. |
| `moodle_repositories` | `MOODLE_REPOS` | Legacy only | JSON `org/repo` array; default `["moodle/moodle"]`. |
| `os` | `MOODLE_OS` | Legacy only | JSON runner-label array; default `["ubuntu-latest"]`. Automatic rows always use `ubuntu-latest`, regardless of this setting. |
| `experimental` | `MOODLE_EXPERIMENTAL` | Legacy only | JSON boolean array; default `[false]`. Automatic targets use their catalogue flags. |
| `exclude_matrix` | `MOODLE_EXCLUDE_MATRIX` | Legacy only | JSON array of row-matching objects; default `[]`. For example, `[{"dbtype":"pgsql","php":"8.4"}]`. |
| `plugin_component` | `MOODLE_PLUGIN_COMPONENT` | PHPUnit only | Optional Moodle component override; normally detected from `version.php`. |
| `plugin_path` | `MOODLE_PLUGIN_PATH` | PHPUnit only | Optional plugin install-path override; normally detected. |
| `additional_phpunit_arguments` | `MOODLE_ADDITIONAL_PHPUNIT_ARGUMENTS` | PHPUnit only | Extra PHPUnit CLI arguments; default empty. |
| `additional_behat_arguments` | `MOODLE_ADDITIONAL_BEHAT_ARGUMENTS` | Behat only | Extra Behat CLI arguments; default empty. |
| `org` | `MOODLE_ORG` | GitHub App setup | App installation owner; defaults to the calling repository's owner. |

The App ID can separately be set as `MOODLE_CI_APP_ID` in an Actions **secret or variable** (secret takes precedence). `MOODLE_CI_APP_PRIVATE_KEY` must be an Actions **secret**, not a variable. Use `secrets: inherit` in the caller; see [Private repositories](#private-repositories-github-app).

### Inputs without variable fallbacks

These are set under the caller job's `with:` (not by an organization/repository variable):

| Input | Default / effect |
| --- | --- |
| `automatic` | `'true'` uses the central target catalogue; `'false'` enables the legacy Cartesian matrix and its one-off overrides. |
| `run_phpunit` | `'true'`; PHPUnit runs on PR, push and manual-dispatch events. |
| `run_behat` | `'true'`; Behat runs for `#behat` comments, manual dispatch and stable-branch pushes. Set `behat_on_pull_request: 'true'` to run it on ordinary PRs too. |
| `behat_on_pull_request` | `'false'`; controls automatic Behat on PRs. |
| `behat_increase_timeout` | `'2'` multiplier; `'0'` disables the increase. |
| `behat_step_timeout_minutes` | `'45'` minute step limit. |
| `post_no_tests_comment` | For `#behat`, defaults to `'true'`; otherwise `'false'`. |
| `post_commands_comment` | `'true'`; posts command help when a PR is opened. |
| `fail_on_empty_test_suite` | `'true'`; fail PHPUnit when no tests execute. |
| `pull_request_number` | Empty; optional explicit PR for comment/manual workflows. |
| `action_ref` | `'master'`; when calling a development ref of the reusable workflow, set this to the same ref so subactions and the resolver match. |

All JSON-array examples above are **strings** under YAML `with:` (use single quotes around the JSON). The on/off inputs are strings too (`'true'` / `'false'`). Invalid `products` and automatic-mode PHP filters fail setup; some legacy matrix inputs fall back to defaults with a warning when malformed. Empty `products` means both only in automatic mode; legacy mode builds its matrix from Moodle refs/repositories instead.

### Event-specific behavior

- For a normal PR, push or `workflow_dispatch`, the caller's `with:` values override repository variables, which override organization variables. The caller controls its own event triggers: an unrestricted `push:` and `pull_request:` can start two runs for the same PR commit. Restrict `push.branches` as in the [recommended workflow](#recommended-workflow); a PR head branch matching that filter still starts both events. Concurrency cancels superseded PR runs, not push runs.
- For a **same-repository `#behat` comment**, GitHub starts the workflow on the default branch, but setup reads the **PR merge commit's** `.github/workflows/ci.yml`. Its literal `with:` values for `automatic`, `products`, matrix filters, dependencies and Behat settings override repository/organization variables. Omitted values fall back to variables/defaults, **not** the default-branch caller's `with:`. Dynamic `${{ ... }}` expressions in the PR workflow's `with:` fail because they cannot be evaluated safely. The PR file must have exactly one matching reusable-workflow job; it cannot change `org` or `action_ref` relative to the default-branch caller. Fork PR `#behat` comments are rejected. Other settings such as `behat_on_pull_request`, PHPUnit options, and App setup are not reconfigured from the PR's `with:` on a comment run. `issue_comment` must be enabled in the plugin repository's default-branch workflow for this to work.

With `automatic: 'false'`, the legacy fallbacks are Moodle 5.2, PHP 8.4, `moodle/moodle`, `ubuntu-latest`, MySQLi and non-experimental. With `automatic: 'true'`, the legacy Moodle-ref, repository, runner, experimental, exclusion and organization/repository PHP-version variables are ignored. If an explicit PHP filter excludes a non-experimental catalogue target, setup fails; excluded experimental targets are skipped with a warning.

## Automatic Moodle matrix

The central [JSON catalogue](.github/moodle-test-targets.json) defines available test targets. Moodle has 4.0–4.5 and 5.0–5.3; Workplace has 4.0–4.1, 4.3–4.5 and 5.0–5.2, using `WORKPLACE_*_LATEST` rather than numbered or rolling refs. Each entry couples a release, product, exact core repository/ref, `required` flag and inclusive `php_min`/`php_max` versions. All PHP minor versions between those bounds are tested; for example `8.2`–`8.4` generates 8.2, 8.3 and 8.4. Set `version_file: "public/version.php"` for core branches using Moodle's new `public/` layout (otherwise the root file is used). Set `experimental: true` to make test failures non-blocking and skip a target with a warning when its core version cannot be read or its PHP range does not match the filter. The private Workplace fork's PHP support, refs and version-file paths still need verification with App access.

For a PR, setup reads `version.php` from the PR **merge ref** and uses the PR's base branch; for a push it uses that commit and branch. Plugin release branches partition **both products'** catalogues by version: `MOODLE_41_STABLE` owns releases from 4.1 up to (but not including) the next release branch in that plugin repository. The branch prefix is not a product restriction. `41`/`401` and `50`/`500` normalize to the same releases. Workplace `*_LATEST` branches are also recognized. The first branch-name segment must be at least four characters, so issue branches beginning `mma_`, `tk_`, or `abc_` do not create release boundaries. PRs into **any** branch still run. Both products require a readable core ref, so private Workplace tests need GitHub App access even when the plugin branch starts `MOODLE_`.

Within its branch range, the resolver tests the **first version compatible with the plugin's `version.php` for each product** (the baseline), even if that target has `required: false`. It also tests later compatible targets marked `required: true`. Optional intervening releases do not run. The required milestones are 4.1, 4.5, 5.0 and 5.2 for both products, plus Moodle 5.3 (experimental/non-blocking); 4.0, 4.2, 4.3, 4.4 and 5.1 remain available as baselines. For example, a 5.1 plugin branch between 5.0 and 5.2 tests only 5.1, while a 4.1 branch followed by 4.5 tests only 4.1. Non-release branches use the same baseline-plus-required policy without a plugin-branch range.

The tested revision's `$plugin->requires`, `$plugin->supported` and `$plugin->incompatible` further filter the selection. Literal values are read without running plugin PHP. Core `version.php` is checked at each candidate ref to establish compatibility; the branch name does not override `version.php`. If no compatible target remains, setup fails. Without an explicit upper bound in plugin metadata, tests are the final check for compatibility with newer releases.

**One-off overrides remain available in legacy mode.** `with: moodle_versions`, `moodle_repositories`, `php_versions`, `os`, `experimental`, and `exclude_matrix` (or their existing `MOODLE_SUPPORTED_VERSIONS`, `MOODLE_REPOS`, `MOODLE_SUPPORTED_PHP_VERSIONS`, `MOODLE_OS`, `MOODLE_EXPERIMENTAL`, and `MOODLE_EXCLUDE_MATRIX` variables) retain their JSON-array format and Cartesian-product behavior. To test an unlisted version or an exceptional combination, set `automatic: 'false'` and supply the required overrides. Remove that input (or set it back to `'true'`) to use the catalogue regardless of old org/repo Moodle-ref and repository variables; there is no need to delete them. Database types and dependencies keep their previous inputs/variables in either mode.

Plugin component and install path are auto-detected from `$plugin->component` in `version.php`. Use `plugin_component` or `plugin_path` only for unusual plugins.

When using the root action, `action_ref` defaults to the same ref as `uses: praxisdigital/moodle-test-action@...`. The reusable workflow's `action_ref` defaults to `master`; when calling a development ref of `.github/workflows/ci.yml`, pass that same development ref as `action_ref` so setup checks out the matching resolver and catalogue.

## Code coverage

PHPUnit runs enable Xdebug coverage and upload Clover XML, an exact executable-line
JSON map, a text summary, and
plugin-path metadata as a `coverage-*` artifact for each matrix target, including
failed runs that produced reports. The reusable workflow automatically runs a
final coverage job on pull requests, merges the matrix reports, and updates one
PR comment with total and file-by-file coverage differences against the latest
successful base-branch run with coverage artifacts.

Fallback runs using Moodle's generated PHPUnit configuration replace its source
filter with the plugin directory (excluding `tests` and `vendor`). Plugin-owned
PHPUnit configurations retain explicit source filters and exclusions; configurations
without an include filter receive plugin-scoped coverage automatically. Temporary
configurations stay beside their originals to preserve relative paths. The summary also rejects
files outside the plugin path and requires valid plugin-path metadata. Artifacts
are published only when non-empty Clover and executable-line reports exist; baseline discovery
skips older metadata-only artifacts and continues to the next successful run
until a usable executable-line report is found. Baseline discovery and merging
share metadata, path, and executable-line validation. Old Clover-only artifacts
are skipped: run the base-branch workflow again after upgrading.

Before launching tests, reusable workflow setup uploads a versioned
`coverage-expected-targets` artifact containing `expected-targets.json`, derived
from the resolved PHPUnit matrix including experimental targets. Its target
identities use the same function as the report producer. Numeric comparisons
require each run's reports to cover its independently recorded expected set,
identical successfully parsed target sets, and no rejected reports on either side.
Otherwise the PR comment reports **Coverage incomplete / not comparable** and
lists missing/rejected targets, withholding deltas and file additions/removals.
Failed test jobs still upload valid reports; failed jobs without a report cannot
silently turn a partial matrix into a comparable diff.

Standalone/root-action callers must also upload `coverage-expected-targets`
before tests. Generate `expected-targets.json` with
`coverage-summary/targets.js`'s `expectedTargets(rows)` using their resolved
matrix rows (`suite: 'phpunit'`, `moodle`, `php`, `dbtype`, `os`,
`moodle_repository`), rather than deriving expectations from received reports.
Missing/invalid manifests withhold numeric comparisons. Baseline runs predating
the manifest must be refreshed.

Target identities include the normalized `experimental` flag, so legacy matrices
containing both `false` and `true` remain distinct. Baseline selection uses the
newest successful push with a complete expected matrix and no rejected reports,
continuing to older runs when a newer candidate is incomplete. The mandatory
manifest is downloaded independently of `artifact-prefix`, including when the
report prefix is `coverage-target-`.

The line map is generated locally from PHPUnit's raw coverage export, which is
deleted before upload. It preserves executable method-start lines that Clover
represents as methods, without counting non-executable method declarations.

Keep the caller workflow enabled for pushes to PR base branches as shown above
so baseline artifacts are available. The caller needs `actions: read` and
`issues: write` and `pull-requests: write` in addition to the normal CI permissions. If no baseline exists,
the comment explains why a diff is unavailable. When testing a development ref,
set `action_ref` to the same ref as the reusable workflow.

Users of the root compatibility action must add a final job themselves:

```yaml
  coverage:
    needs: PHPUnit
    if: ${{ always() && github.event_name == 'pull_request' }}
    runs-on: ubuntu-latest
    steps:
      - uses: praxisdigital/moodle-test-action/coverage-summary@master
```

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

- To verify resolver and PR-workflow parsing changes locally, run `npm ci --ignore-scripts` and `npm test`. The `#behat` setup job installs the locked YAML parser only when it needs to read a PR workflow.
- PHPUnit supports `mysqli`, `pgsql`, and `sqlsrv`.
- Behat supports `mysqli` and `pgsql`.
- Dependencies use `org/repo@ref` format.
