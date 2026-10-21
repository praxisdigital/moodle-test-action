<?php
final class Methods
{
    public function covered(): int { return 1; }
    public function uncovered(): int { return 2; }
    public function multiline(): int
    {
        return 3;
    }
}
