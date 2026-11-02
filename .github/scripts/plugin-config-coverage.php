<?php
// Actual PHPUnit integration test. The PHAR is fetched and checksum-verified by CI.
[$script, $phpunit] = $argv;
$root = sys_get_temp_dir() . '/plugin-config-coverage-' . bin2hex(random_bytes(6));
mkdir($root . '/moodle/local/mxsdk/classes', 0777, true);
$plugin = $root . '/moodle/local/mxsdk';
mkdir($plugin . '/tests');
copy(__DIR__ . '/fixtures/coverage-methods/Methods.php', $plugin . '/classes/Methods.php');
file_put_contents($plugin . '/bootstrap.php', '<?php require __DIR__ . "/classes/Methods.php";');
file_put_contents($plugin . '/tests/MethodsTest.php', '<?php
final class MethodsTest extends PHPUnit\Framework\TestCase {
    public function testCovered(): void {
        $this->assertSame(1, (new Methods())->covered());
        $this->assertSame(3, (new Methods())->multiline());
    }
}');
$prepare = dirname(__DIR__, 2) . '/phpunit-test/prepare-coverage.php';
$export = dirname(__DIR__, 2) . '/phpunit-test/export-lines.php';
function run_command(array $args): string {
    exec(implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1', $output, $status);
    $text = implode("\n", $output);
    if ($status !== 0) {
        throw new RuntimeException("Command exited $status:\n$text");
    }
    return $text;
}
try {
    // No filter, exclusion-only, and explicit include filters are all supported.
    foreach (['', '<source><exclude><file>ignored.php</file></exclude></source>',
            '<source><include><directory suffix=".php">classes</directory></include><exclude><file>ignored.php</file></exclude></source>'] as $index => $source) {
        $original = '<phpunit bootstrap="bootstrap.php" failOnPhpunitWarning="true">'
            . '<testsuites><testsuite name="plugin"><directory>tests</directory></testsuite></testsuites>' . $source . '</phpunit>';
        file_put_contents($plugin . '/phpunit.xml', $original);
        $config = $plugin . '/phpunit-coverage.xml';
        run_command([PHP_BINARY, $prepare, $plugin . '/phpunit.xml', $config, $plugin, '11', 'preserve']);
        if ($index === 2 && file_get_contents($config) !== $original) {
            throw new RuntimeException('Explicit filter was changed');
        }
        if ($index > 0 && !str_contains(file_get_contents($config), 'ignored.php')) {
            throw new RuntimeException('Existing exclusion was lost');
        }
        $output = run_command([PHP_BINARY, $phpunit, '-c', $config, '--coverage-clover=' . $root . '/clover.xml',
            '--coverage-php=' . $root . '/raw.php']);
        if (stripos($output, 'No filter') !== false || stripos($output, 'warning') !== false) {
            throw new RuntimeException('Unexpected PHPUnit warning: ' . $output);
        }
        run_command([PHP_BINARY, $export, $phpunit, $root . '/raw.php', $root . '/lines.json']);
        $json = json_decode(file_get_contents($root . '/lines.json'), true, 512, JSON_THROW_ON_ERROR);
        if (($json['files'][$plugin . '/classes/Methods.php'] ?? null) !== [4 => true, 5 => false, 8 => true]) {
            throw new RuntimeException('Expected covered and uncovered executable lines were not exported');
        }
        if (!is_file($root . '/clover.xml')) {
            throw new RuntimeException('Clover report was not generated');
        }
        echo "Configuration case $index: PHPUnit exit 0, no warnings, exact line report generated\n";
    }
} finally {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($root);
}
