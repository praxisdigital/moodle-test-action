#!/bin/bash
dependencies=${DEPENDENCIES:-""}
current_path=$GITHUB_ACTION_PATH
repo_owner=${GITHUB_REPOSITORY_OWNER}
token=${GITHUB_TOKEN:-""}
versions_dir=${VERSION_DIR:-"$GITHUB_ACTION_PATH/.versions"}
moodle_dir=${MOODLE_DIR:-"$GITHUB_WORKSPACE"}

mkdir -p $versions_dir

# List of plugin types - Get it from moodle/moodle/lib/components.json in "plugintypes" key
plugin_types_list="aiplacement:ai/placement
aiprovider:ai/provider
antivirus:lib/antivirus
availability:availability/condition
qtype:question/type
mod:mod
auth:auth
calendartype:calendar/type
communication:communication/provider
customfield:customfield/field
enrol:enrol
message:message/output
block:blocks
media:media/player
filter:filter
editor:lib/editor
format:course/format
dataformat:dataformat
profilefield:user/profile/field
report:report
coursereport:course/report
gradeexport:grade/export
gradeimport:grade/import
gradereport:grade/report
gradingform:grade/grading/form
mlbackend:lib/mlbackend
mnetservice:mnet/service
webservice:webservice
repository:repository
portfolio:portfolio
search:search/engine
qbank:question/bank
qbehaviour:question/behaviour
qformat:question/format
plagiarism:plagiarism
tool:admin/tool
cachestore:cache/stores
cachelock:cache/locks
fileconverter:files/converter
contenttype:contentbank/contenttype
theme:theme
local:local
h5plib:h5p/h5plib
paygw:payment/gateway
smsgateway:sms/gateway"

if [ -z "$repo_owner" ]; then
    echo "No repository owner found"
    exit 3
fi

if [ -z "$dependencies" ]; then
    echo "No dependencies to install"
    exit 0
fi

download_version_file () {
    repository=$1
    branch=$2
    save_as=$3

    url="https://raw.githubusercontent.com/$repository/$branch/version.php"
    printf "Downloading version file from $url\n"

    if [ -z "$token" ]; then
        curl -o $save_as -s $url
        return
    fi

    curl -H "Authorization: Bearer $token" \
        -s -o $save_as \
        $url
}

# # Save plugin path to env
version_file_path="$versions_dir/$GITHUB_REPOSITORY_ID-$GITHUB_SHA-version.php"
download_version_file "$GITHUB_REPOSITORY" "$GITHUB_REF" "$version_file_path"

if [ ! -f "$version_file_path" ]; then
    echo "Failed to download version file for $dep"
    errors="$errors\nFailed to download version file for $dep"
    continue
fi

# Extract component name from version file
version_content=$(cat $version_file_path)
component_name=$(echo "$version_content" | grep "\$plugin->component" | tr -d " " | cut -d'=' -f2 | tr -d " ';")

component_type=$(echo "$component_name" | cut -d'_' -f1)
plugin_name=$(echo "$component_name" | cut -d'_' -f2-)

plugin_install_path=$(echo "$plugin_types_list" | grep "$component_type" | cut -d':' -f2)
install_dir="${moodle_dir}/$plugin_install_path/$plugin_name"

if [ -z "$install_dir" ]; then
    printf "Failed to extract install directory from $dep\n"
    printf "Please provide inputs.plugin_path\n"
    exit 1
fi

# Reset variables
version_file_path=''
version_content=''
component_name=''
component_type=''
plugin_name=''
plugin_install_path=''
install_dir=''

echo "PLUGIN_PATH=$install_dir" >> $GITHUB_ENV

errors=''

for dep in $dependencies; do
    if [ -z "$dep" ]; then
        continue
    fi

    owner=$repo_owner
    repo=''
    path=''
    ref=''

    # Format: "user/repo:path@ref"
    if [[ $dep =~ ^[a-zA-Z0-9\._-]+/[a-zA-Z0-9\._-]+:.+@.+$ ]]; then
        owner=$(echo $dep | cut -d'/' -f1)
        repo=$(echo $dep | cut -d'/' -f2 | cut -d':' -f1)
        path=$(echo $dep | cut -d':' -f2 | cut -d'@' -f1)
        ref=$(echo $dep | cut -d'@' -f2)
        
        if [[ $path != /* ]]; then
            path="/$path"
        fi

        printf "Matched user/repo:path@ref\n"
    # Format: "user/repo@ref"
    elif [[ $dep =~ ^[a-zA-Z0-9\._-]+/[a-zA-Z0-9\._-]+@.+$ ]]; then
        owner=$(echo $dep | cut -d'/' -f1)
        repo=$(echo $dep | cut -d'/' -f2 | cut -d'@' -f1)
        ref=$(echo $dep | cut -d'@' -f2)
        printf "Matched user/repo@ref\n"
    # Format: "repo/@ref"
    elif [[ $dep =~ ^[a-zA-Z0-9\._-]+@.+$ ]]; then
        repo=$(echo $dep | cut -d'/' -f1 | cut -d'@' -f1)
        ref=$(echo $dep | cut -d'@' -f2)
        printf "Matched repo/@ref\n"
    else
        echo "Invalid format: $dep"
        errors="$errors\nInvalid format: $dep"
        continue
    fi

    if [[ -z "$path" ]]; then
        # Download version file
        version_file_path="$versions_dir/$owner-$repo-$ref-version.php"
        download_version_file "$owner/$repo" "$ref" "$version_file_path"

        if [ ! -f "$version_file_path" ]; then
            echo "Failed to download version file for $dep"
            errors="$errors\nFailed to download version file for $dep"
            continue
        fi

        # Extract component name from version file
        version_content=$(cat $version_file_path)
        component_name=$(echo "$version_content" | grep "\$plugin->component" | tr -d " " | cut -d'=' -f2 | tr -d " ';")

        if [[ -z "$component_name" ]]; then
            echo "Failed to extract component name from $dep"
            errors="$errors\nFailed to extract component name from $dep"
            continue
        fi

        # Get before the first _ as component type and after the first _ as plugin name
        component_type=$(echo "$component_name" | cut -d'_' -f1)
        plugin_name=$(echo "$component_name" | cut -d'_' -f2-)

        plugin_install_path=$(echo "$plugin_types_list" | grep "$component_type" | cut -d':' -f2)
        install_dir="${moodle_dir}/$plugin_install_path/$plugin_name"
    else
        install_dir="${moodle_dir}${path}"
    fi

    printf "Installing to $install_dir\n"

    if [[ -z "$install_dir" ]]; then
        printf "Failed to extract install directory from $dep\n"
        printf "Please use the format: user/repo:path@ref\n"
        errors="$errors\nFailed to extract install directory from $dep"
        continue
    fi

    printf "Installing or update $dep in $install_dir\n"

    # Clone repository

    url="https://github.com/$owner/$repo.git"
    if [ ! -z "$token" ]; then
        url="https://oauth2:${token}@github.com/$owner/$repo.git"
    fi

    if [ ! -d "$install_dir" ]; then
        printf "Checkout $owner/$repo@$ref\n"
        git clone --quiet $url $install_dir
    fi

    git -C $install_dir fetch --quiet --all
    git -C $install_dir checkout --quiet $ref

    printf "$dep is updated\n"
done

if [ ! -z "$errors" ]; then
    echo -e "Errors: $errors"
    exit 1
fi

# Cleanup
rm -rf $versions_dir
