<?php
// Keep this configuration beside the original so its relative paths retain their meaning.
[$script, $input, $output, $plugin, $major] = $argv;
$preserve = ($argv[5] ?? '') === 'preserve';
if (!is_dir($plugin) || !ctype_digit($major)) {
    throw new InvalidArgumentException('A plugin directory and PHPUnit major version are required');
}
$document = new DOMDocument();
$document->preserveWhiteSpace = false;
$document->formatOutput = true;
if (!$document->load($input, LIBXML_NONET)) {
    throw new RuntimeException('Cannot read PHPUnit configuration');
}
$xpath = new DOMXPath($document);
// PHPUnit <=9 keeps source selection under coverage; >=10 uses source.
$name = (int)$major >= 10 ? 'source' : 'coverage';
$parent = $xpath->query('/phpunit/' . $name)->item(0);
if ($preserve && $xpath->query('/phpunit/' . $name . '/include/directory | /phpunit/' . $name . '/include/file')->length) {
    if (!copy($input, $output)) {
        throw new RuntimeException('Cannot copy plugin PHPUnit configuration');
    }
    exit(0);
}
if (!$parent) {
    $parent = $document->documentElement->appendChild($document->createElement($name));
}
foreach (iterator_to_array($xpath->query($preserve ? './include' : './include | ./exclude', $parent)) as $node) {
    $parent->removeChild($node);
}
$include = $parent->appendChild($document->createElement('include'));
$directory = $include->appendChild($document->createElement('directory'));
$directory->setAttribute('suffix', '.php');
$directory->appendChild($document->createTextNode($plugin));
$exclude = $xpath->query('./exclude', $parent)->item(0);
if (!$exclude) {
    $exclude = $parent->appendChild($document->createElement('exclude'));
}
foreach (['tests', 'vendor'] as $subdirectory) {
    $directory = $exclude->appendChild($document->createElement('directory'));
    $directory->appendChild($document->createTextNode($plugin . '/' . $subdirectory));
}
if ($document->save($output) === false) {
    throw new RuntimeException('Cannot write plugin coverage configuration');
}
