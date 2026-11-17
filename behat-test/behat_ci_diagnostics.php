<?php
// This context is copied into Moodle's core Behat contexts by the shared CI action.
// It records Chrome's browser and Network logs while the scenario's WebDriver session still exists.

require_once(__DIR__ . '/../../behat/behat_base.php');

use Behat\Behat\Hook\Scope\AfterStepScope;
use Behat\Behat\Hook\Scope\BeforeScenarioScope;
use Behat\Testwork\Tester\Result\TestResult;

class behat_ci_diagnostics extends behat_base {
    private static $scenario = 0;
    private static $scenario_title = '';
    private static $requests = [];

    /** @BeforeScenario */
    public function begin_scenario(BeforeScenarioScope $scope): void {
        self::$scenario++;
        self::$scenario_title = $scope->getScenario()->getTitle();
        self::$requests = [];
    }

    /** @AfterStep */
    public function capture_step(AfterStepScope $scope): void {
        $directory = getenv('CI_BEHAT_DIAGNOSTICS_DIR');
        if (!$directory) {
            return;
        }

        $session = $this->getSession();
        if (!$session->isStarted() || !method_exists($session->getDriver(), 'getWebDriver')) {
            return;
        }

        $file = $directory . '/browser-' . getmypid() . '-' . self::$scenario . '.jsonl';
        $step = [
            'feature' => $scope->getFeature()->getTitle(),
            'scenario' => self::$scenario_title,
            'step' => $scope->getStep()->getText(),
            'line' => $scope->getStep()->getLine(),
        ];
        $failed = $scope->getTestResult()->getResultCode() === TestResult::FAILED;

        try {
            $logs = $session->getDriver()->getWebDriver()->manage();
            try {
                $browserlogs = $logs->getLog('browser');
            } catch (\Throwable $e) {
                $browserlogs = [];
                $this->write($file, $step + ['type' => 'diagnostics_error', 'source' => 'browser', 'message' => $e->getMessage()]);
            }
            foreach ($browserlogs as $entry) {
                $this->write($file, $step + [
                    'type' => 'console',
                    'level' => $entry['level'] ?? 'unknown',
                    'message' => substr($entry['message'] ?? '', 0, 4000),
                    'timestamp' => $entry['timestamp'] ?? null,
                ]);
            }

            try {
                $performancelogs = $logs->getLog('performance');
            } catch (\Throwable $e) {
                $performancelogs = [];
                $this->write($file, $step + ['type' => 'diagnostics_error', 'source' => 'performance', 'message' => $e->getMessage()]);
            }
            foreach ($performancelogs as $entry) {
                $event = json_decode($entry['message'] ?? '', true);
                $event = $event['message'] ?? [];
                $method = $event['method'] ?? '';
                $params = $event['params'] ?? [];
                $id = $params['requestId'] ?? null;
                if ($id === null) {
                    continue;
                }

                if ($method === 'Network.requestWillBeSent') {
                    // A redirected request reuses its request ID.
                    if (isset($params['redirectResponse'])) {
                        $this->report_response($file, $step, $id, $params['redirectResponse']);
                    }
                    self::$requests[$id] = [
                        'url' => $this->request_url($params['request']['url'] ?? ''),
                        'method' => $params['request']['method'] ?? '',
                        'started' => $params['wallTime'] ?? microtime(true),
                        'timestamp' => $params['timestamp'] ?? null,
                        'status' => null,
                    ];
                } else if ($method === 'Network.responseReceived') {
                    if (isset(self::$requests[$id])) {
                        self::$requests[$id]['status'] = $params['response']['status'] ?? null;
                    }
                    $this->report_response($file, $step, $id, $params['response'] ?? []);
                } else if ($method === 'Network.loadingFailed') {
                    $this->write($file, $step + [
                        'type' => 'request_failed',
                        'request' => self::$requests[$id] ?? ['requestId' => $id],
                        'error' => $params['errorText'] ?? '',
                        'blocked' => $params['blockedReason'] ?? null,
                    ]);
                    unset(self::$requests[$id]);
                } else if ($method === 'Network.loadingFinished') {
                    if (isset(self::$requests[$id])) {
                        $request = self::$requests[$id];
                        $seconds = isset($request['timestamp'], $params['timestamp'])
                            ? $params['timestamp'] - $request['timestamp'] : 0;
                        if ($seconds >= 3) {
                            $this->write($file, $step + [
                                'type' => 'slow_request',
                                'request' => $request,
                                'duration_seconds' => round($seconds, 3),
                            ]);
                        }
                        unset(self::$requests[$id]);
                    }
                }
            }

            $pending = [];
            foreach (self::$requests as $request) {
                $seconds = microtime(true) - $request['started'];
                if ($failed || $seconds >= 2) {
                    $pending[] = $request + ['age_seconds' => round($seconds, 3)];
                }
            }
            if ($failed || $pending) {
                $this->write($file, $step + [
                    'type' => 'step_requests',
                    'failed' => $failed,
                    'outstanding_count' => count(self::$requests),
                    'outstanding' => array_slice($pending, 0, 30),
                ]);
            }
        } catch (\Throwable $e) {
            // Diagnostics must never replace a Behat assertion or pending-JS failure.
            $this->write($file, $step + ['type' => 'diagnostics_error', 'message' => $e->getMessage()]);
        }
    }

    private function report_response(string $file, array $step, string $id, array $response): void {
        $status = $response['status'] ?? null;
        if ($status === null || $status < 400) {
            return;
        }
        $this->write($file, $step + [
            'type' => 'http_error',
            'status' => $status,
            'request' => self::$requests[$id] ?? ['requestId' => $id],
            'url' => $this->request_url($response['url'] ?? ''),
        ]);
    }

    private function request_url(string $url): string {
        // Keep the endpoint and query parameter names without recording session tokens or other values.
        $parts = parse_url($url);
        if (!$parts) {
            return '';
        }
        $names = [];
        foreach (explode('&', $parts['query'] ?? '') as $parameter) {
            if ($parameter !== '') {
                $names[] = rawurldecode(explode('=', $parameter, 2)[0]);
            }
        }
        return ($parts['scheme'] ?? '') . '://' . ($parts['host'] ?? '') . ($parts['path'] ?? '') .
            ($names ? '?' . implode('&', $names) : '');
    }

    private function write(string $file, array $record): void {
        file_put_contents($file, json_encode($record, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND);
    }
}
