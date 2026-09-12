param(
    [ValidateSet('dev', 'start', 'test', 'build', 'privacy:check')]
    [string]$Task = 'dev'
)

$ErrorActionPreference = 'Stop'
$femNovaPreviousPath = $env:PATH
$femNovaExitCode = 1
Push-Location -LiteralPath $PSScriptRoot
try {
    $femNovaPortable = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '.local-tools') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^node-v22\.\d+\.\d+-win-x64$' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($femNovaPortable) {
        $femNovaNode = Join-Path $femNovaPortable.FullName 'node.exe'
    } else {
        $femNovaNode = (Get-Command node -ErrorAction Stop).Source
    }
    $femNovaVersion = & $femNovaNode -p 'process.versions.node'
    if ($femNovaVersion -notmatch '^22\.') { throw 'Install Node.js 22 (22.9 or newer), then run npm ci.' }
    $femNovaNodeDirectory = Split-Path -Parent $femNovaNode
    $femNovaNpm = Join-Path $femNovaNodeDirectory 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $femNovaNpm)) { throw 'The selected Node.js installation does not include npm.' }
    $env:PATH = $femNovaNodeDirectory + ';' + $femNovaPreviousPath
    & $femNovaNode $femNovaNpm run $Task
    $femNovaExitCode = $LASTEXITCODE
} finally {
    $env:PATH = $femNovaPreviousPath
    Pop-Location
}
exit $femNovaExitCode
