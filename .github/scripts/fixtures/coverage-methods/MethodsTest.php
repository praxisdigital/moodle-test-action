<?php
require_once __DIR__ . '/Methods.php';
final class MethodsTest extends PHPUnit\Framework\TestCase
{
    public function testCovered(): void
    {
        $this->assertSame(1, (new Methods())->covered());
        $this->assertSame(3, (new Methods())->multiline());
    }
}
