<?php
// Run with: php behat-test/behat_ci_diagnostics.test.php

namespace Behat\Behat\Hook\Scope {
    class BeforeScenarioScope {
        public function getScenario() {
            return new class {
                public function getTitle() { return 'Course navigation'; }
            };
        }
    }
    class AfterStepScope {
        public function getFeature() {
            return new class {
                public function getTitle() { return 'Course feature'; }
            };
        }
        public function getStep() {
            return new class {
                public function getText() { return 'I am on the course page'; }
                public function getLine() { return 54; }
            };
        }
        public function getTestResult() {
            return new class {
                public function getResultCode() { return \Behat\Testwork\Tester\Result\TestResult::FAILED; }
            };
        }
    }
}

namespace Behat\Testwork\Tester\Result {
    class TestResult {
        public const FAILED = 99;
    }
}

namespace {
    function check(bool $condition, string $message): void {
        if (!$condition) {
            throw new \RuntimeException($message);
        }
    }

    $root = sys_get_temp_dir() . '/behat-ci-diagnostics-' . getmypid();
    $contexts = $root . '/public/lib/tests/behat';
    $base = $root . '/public/lib/behat';
    mkdir($contexts, 0777, true);
    mkdir($base, 0777, true);
    mkdir($root . '/output');

    try {
        // Simulate Moodle's context discovery without a full Moodle installation.
        file_put_contents($base . '/behat_base.php', '<?php class behat_base { public function getSession() { return $GLOBALS["session"]; } }');
        copy(__DIR__ . '/behat_ci_diagnostics.php', $contexts . '/behat_ci_diagnostics.php');
        require $contexts . '/behat_ci_diagnostics.php';

        $url = 'http://localhost:8000/lib/requirejs.php?jsrev=123&sesskey=secret';
        $event = function (string $method, array $params): array {
            return ['message' => json_encode(['message' => ['method' => $method, 'params' => $params]])];
        };
        $start = microtime(true) - 5;
        $performance = [
            $event('Network.requestWillBeSent', ['requestId' => 'slow', 'wallTime' => $start, 'timestamp' => 1,
                'request' => ['url' => $url, 'method' => 'GET']]),
            $event('Network.responseReceived', ['requestId' => 'slow', 'response' => ['url' => $url, 'status' => 503]]),
            $event('Network.loadingFinished', ['requestId' => 'slow', 'timestamp' => 5]),
            $event('Network.requestWillBeSent', ['requestId' => 'failed', 'wallTime' => $start, 'timestamp' => 2,
                'request' => ['url' => $url, 'method' => 'GET']]),
            $event('Network.loadingFailed', ['requestId' => 'failed', 'errorText' => 'net::ERR_CONNECTION_RESET']),
            $event('Network.requestWillBeSent', ['requestId' => 'waiting', 'wallTime' => $start, 'timestamp' => 3,
                'request' => ['url' => $url, 'method' => 'GET']]),
        ];
        $options = new class($performance) {
            public function __construct(private array $performance) {}
            public function getLog(string $type): array {
                return $type === 'browser' ? [['level' => 'SEVERE', 'message' => 'Uncaught TypeError: failed',
                    'timestamp' => 123]] : $this->performance;
            }
        };
        $GLOBALS['session'] = new class($options) {
            public function __construct(private object $options) {}
            public function isStarted(): bool { return true; }
            public function getDriver(): object {
                return new class($this->options) {
                    public function __construct(private object $options) {}
                    public function getWebDriver(): object {
                        return new class($this->options) {
                            public function __construct(private object $options) {}
                            public function manage(): object { return $this->options; }
                        };
                    }
                };
            }
        };
        putenv('CI_BEHAT_DIAGNOSTICS_DIR=' . $root . '/output');

        $context = new \behat_ci_diagnostics();
        $context->begin_scenario(new \Behat\Behat\Hook\Scope\BeforeScenarioScope());
        $context->capture_step(new \Behat\Behat\Hook\Scope\AfterStepScope());

        $files = glob($root . '/output/*.jsonl');
        check(count($files) === 1, 'Expected one diagnostic file');
        $content = file_get_contents($files[0]);
        $records = array_map('json_decode', explode("\n", trim($content)));
        $types = array_column(array_map(fn($record) => (array)$record, $records), 'type');
        foreach (['console', 'http_error', 'slow_request', 'request_failed', 'step_requests'] as $type) {
            check(in_array($type, $types, true), 'Missing diagnostic: ' . $type);
        }
        check(!str_contains($content, 'secret') && !str_contains($content, 'jsrev=123'), 'Leaked query values');
        check(str_contains($content, 'jsrev&sesskey'), 'Missing query parameter names');
        $snapshot = $records[array_search('step_requests', $types, true)];
        check($snapshot->failed && $snapshot->outstanding_count === 1, 'Wrong outstanding request snapshot');
        check($snapshot->outstanding[0]->method === 'GET', 'Missing request method');
        echo "Behat browser diagnostics smoke test passed\n";
    } finally {
        foreach (glob($root . '/output/*') ?: [] as $file) {
            unlink($file);
        }
        foreach ([$contexts . '/behat_ci_diagnostics.php', $base . '/behat_base.php'] as $file) {
            if (file_exists($file)) {
                unlink($file);
            }
        }
        foreach ([$root . '/output', $contexts, dirname($contexts), dirname(dirname($contexts)), $base,
            dirname($base), dirname(dirname($base)), $root . '/public', $root] as $dir) {
            if (is_dir($dir)) {
                @rmdir($dir);
            }
        }
    }
}
