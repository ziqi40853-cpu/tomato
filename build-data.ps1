$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "build-data.js"
node $script
