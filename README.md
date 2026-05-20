# Guides

#### Basic example of how to use it.
[.github/workflows/example.yml](https://github.com/praxisdigital/moodle-test-action/tree/HEAD/.github/workflows/example.yml)

#### Example of how to use it with static dependencies.
[.github/workflows/example-static-dependendies.yml](https://github.com/praxisdigital/moodle-test-action/tree/HEAD/.github/workflows/example-static-dependendies.yml)

# Usage

<!-- start usage -->
```yaml
- uses: praxisdigital/moodle-test-action@master
  with:
    # The name of the plugin
    # Leave it empty to auto-detect from version.php. This is useful when the plugin is in a non-standard component.
    plugin: 'local_pxsdk'

    # The path of where plugin should be install
    plugin-path: 'local/pxsdk'

    # The version of PHP
    php: '8.4'

    # The reference of Moodle repository.
    # Such as MOODLE_502_STABLE or v5.2.0
    moodle: 'MOODLE_502_STABLE'

    # The Moodle source repository to check out.
    # Override this to use a fork or mirror of moodle/moodle.
    moodle_repository: 'moodle/moodle'

    # Which OS that GitHub Actions will be use
    # The list of OS is available in https://github.com/actions/runner-images?tab=readme-ov-file#available-images
    os: 'ubuntu-latest'

    # Additonal arguments to pass to phpunit
    additional_phpunit_arguments: ''

    # Which organization or user that the repository that run the action is belong to.
    # This is being use by the git operation, when the actions try to pull the private repository
    org: 'praxisdigital'

    # The dependencies that the plugin is required to be installed.
    # Format: org/repo@ref (the org/ prefix is required so the checkout step can resolve the clone URL).
    dependencies: |
        praxisdigital/local_pxsdk@master

    # The type of the database that being use for testing
    # We currently support the list below:
    # * mysqli
    # * pgsql
    # * sqlsrv
    dbtype: 'mysqli'

    # Marks the run as experimental. This action does not consume the value itself;
    # it is exposed so caller workflows can read it, e.g.:
    #   continue-on-error: ${{ matrix.experimental }}
    experimental: false

    # The token for private repositories
    PRIVATE_REPO_TOKEN: ''

    # Fail the job if PHPUnit executes zero tests.
    # Guards against silent green builds (e.g. when the plugin ends up in a path
    # Moodle does not scan, such as the Moodle 5.0+ public/ layout move).
    fail_on_empty_test_suite: true
```
<!-- end usage -->
