# moodle-test-action test

This action sets up a Moodle environment for testing plugins.

# What's new

Please refer to the [release page](https://github.com/praxisdigital/moodle-test-action/releases/latest) for the latest release notes.

# Usage

<!-- start usage -->
```yaml
- uses: praxisdigital/moodle-test-action@test
  with:
    # PHP version
    # Default: '8.2'
    php: '8.2'

    # Database type
    # Default: 'mysqli'
    db: 'mysqli'

    # Moodle commit, branch or tag
    # Default: 'MOODLE_404_STABLE'
    moodle: 'MOODLE_404_STABLE'

    # Moodle repository
    # Default: 'moodle/moodle'
    moodle_repo: 'moodle/moodle'

    # Operating system
    # Default: 'ubuntu-latest'
    os: 'ubuntu-latest'

    # Repository owner (organization or user)
    # Default: ${{ github.repository_owner }}
    owner: ''

    # Plugin dependencies. You can specify multiple dependencies.
    # Format: 'repo@ref' or 'owner/repo@ref'
    # Example:
    #     praxisdigital/assignsubmission_pxaiwriter@master
    #     mod_smartlink@MOODLE_42_STABLE
    dependencies: |
      praxisdigital/assignsubmission_pxaiwriter@master
      mod_smartlink@MOODLE_42_STABLE

    # Experimental run
    # Default: false
    experimental: false
    
    # Database name
    # Default: 'test'
    dbname: 'test'

    # Database user
    dbuser: 'test'

    # Database password
    dbpass: 'test'

    # Token for private repositories
    token: ''
```
<!-- end usage -->
