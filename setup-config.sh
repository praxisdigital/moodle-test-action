moodle_dir=$GITHUB_WORKSPACE

echo '<?php' > $moodle_dir/config.php
echo 'class moodle_env {' >> $moodle_dir/config.php
echo '    public static function get_env(string $key, string $default = ""): string {' >> $moodle_dir/config.php
echo '        $value = getenv($key);' >> $moodle_dir/config.php
echo '        return empty($value) ? $default : $value;' >> $moodle_dir/config.php
echo '    }' >> $moodle_dir/config.php
echo '}' >> $moodle_dir/config.php
echo 'unset($CFG);' >> $moodle_dir/config.php
echo 'global $CFG;' >> $moodle_dir/config.php
echo '$CFG = new stdClass();' >> $moodle_dir/config.php
echo '$CFG->dbtype    = moodle_env::get_env("dbtype", "mysqli");' >> $moodle_dir/config.php
echo '$CFG->dblibrary = "native";' >> $moodle_dir/config.php
echo '$CFG->dbhost    = "127.0.0.1";' >> $moodle_dir/config.php
echo '$CFG->dbname    = moodle_env::get_env("dbname", "test");' >> $moodle_dir/config.php
echo '$CFG->dbuser    = moodle_env::get_env("dbuser", "test");' >> $moodle_dir/config.php
echo '$CFG->dbpass    = moodle_env::get_env("dbpass", "test");' >> $moodle_dir/config.php
echo '$CFG->prefix    = "m_";' >> $moodle_dir/config.php
echo '$CFG->dboptions = ["dbcollation" => moodle_env::get_env("dbcollation", "utf8mb4_unicode_ci")];' >> $moodle_dir/config.php
echo '$host = "localhost";' >> $moodle_dir/config.php
echo '$CFG->wwwroot   = "http://{$host}";' >> $moodle_dir/config.php
echo '$CFG->dataroot  = realpath(dirname(__DIR__)) . "/moodledata";' >> $moodle_dir/config.php
echo '$CFG->admin     = "admin";' >> $moodle_dir/config.php
echo '$CFG->directorypermissions = 0777;' >> $moodle_dir/config.php
echo '$CFG->debug = (E_ALL | E_STRICT);' >> $moodle_dir/config.php
echo '$CFG->debugdisplay = 1;' >> $moodle_dir/config.php
echo '$CFG->debugstringids = 1;' >> $moodle_dir/config.php
echo '$CFG->perfdebug = 15;' >> $moodle_dir/config.php
echo '$CFG->debugpageinfo = 1;' >> $moodle_dir/config.php
echo '$CFG->allowthemechangeonurl = 1;' >> $moodle_dir/config.php
echo '$CFG->passwordpolicy = 0;' >> $moodle_dir/config.php
echo '$CFG->cronclionly = 0;' >> $moodle_dir/config.php
echo '$CFG->pathtophp = moodle_env::get_env("pathtophp");' >> $moodle_dir/config.php
echo '$CFG->phpunit_dataroot  = realpath(dirname(__DIR__)) . "/phpunitdata";' >> $moodle_dir/config.php
echo '$CFG->phpunit_prefix = "t_";' >> $moodle_dir/config.php
echo 'define("TEST_EXTERNAL_FILES_HTTP_URL", "http://$host:8080");' >> $moodle_dir/config.php
echo 'define("TEST_EXTERNAL_FILES_HTTPS_URL", "http://$host:8080");' >> $moodle_dir/config.php
echo 'define("TEST_SESSION_REDIS_HOST", $host);' >> $moodle_dir/config.php
echo 'define("TEST_CACHESTORE_REDIS_TESTSERVERS", $host);' >> $moodle_dir/config.php
echo 'require_once(__DIR__ . "/lib/setup.php");' >> $moodle_dir/config.php
