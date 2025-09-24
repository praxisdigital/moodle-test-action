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
    plugin: 'local_pxsdk'

    # The path of where plugin should be install
    plugin-path: 'local/pxsdk'

    # The version of PHP
    php: '8.3'

    # The reference of Moodle repository.
    # Such as MOODLE_500_STABLE or v5.0.2
    moodle: 'MOODLE_500_STABLE'

    # Which OS that GitHub Actions will be use
    # The list of OS is available in https://github.com/actions/runner-images?tab=readme-ov-file#available-images
    os: 'ubuntu-latest'

    # Additonal arguments to pass to phpunit
    additional_phpunit_arguments: ''

    # Which organization or user that the repository that run the action is belong to.
    # This is being use by the git operation, when the actions try to pull the private repository
    org: 'praxisdigital'

    # The dependencies that the plugin is required to be installed
    dependencies: |
        local_pxsdk@master

    # The type of the database that being use for testing
    # We currently support the list below:
    # * mysqli
    # * sqlsrv
    dbtype: 'mysqli'

    # If set to true the error will be ignore.
    experimental: false

    # The token for private repositories
    PRIVATE_REPO_TOKEN: ''
```
<!-- end usage -->