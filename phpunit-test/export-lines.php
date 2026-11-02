<?php
// Read only the raw export just produced locally by PHPUnit, never a downloaded artifact.
[$script, $autoload, $input, $output] = $argv;
require $autoload;
$coverage = require $input;
$files = [];
foreach ($coverage->getReport() as $file) {
    if (!$file instanceof \SebastianBergmann\CodeCoverage\Node\File
            && !is_a($file, 'PHPUnitPHAR\\SebastianBergmann\\CodeCoverage\\Node\\File')) {
        continue;
    }
    $lines = [];
    foreach ($file->lineCoverageData() as $number => $tests) {
        if (is_array($tests)) {
            $lines[$number] = count($tests) > 0;
        }
    }
    $files[$file->pathAsString()] = (object)$lines;
}
file_put_contents($output, json_encode(['version' => 1, 'files' => (object)$files], JSON_THROW_ON_ERROR));
