param(
  [Parameter(Mandatory=$true)][string]$ModelRoot,
  [Parameter(Mandatory=$true)][string]$Wav,
  [string]$Output='docs/performance-baseline.json'
)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$env:CARGO_TARGET_DIR=Join-Path $repo 'src-tauri/target'
Push-Location (Join-Path $repo 'src-tauri')
try {
  & "$env:USERPROFILE/.cargo/bin/cargo.exe" build --manifest-path ../crates/ququ-speech/Cargo.toml --example benchmark --features native
  if($LASTEXITCODE -ne 0){throw 'Benchmark build failed'}
  $raw=& (Join-Path $env:CARGO_TARGET_DIR 'debug/examples/benchmark.exe') $ModelRoot $Wav
  if($LASTEXITCODE -ne 0){throw 'Benchmark failed'}
  $report=$raw | ConvertFrom-Json
  $report | Add-Member cpu (Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)
  $report | Add-Member memory_bytes ([double](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory)
  $report | Add-Member measured_at_utc ([DateTime]::UtcNow.ToString('o'))
  $report | Add-Member build_profile 'debug'
  $report | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $repo $Output) -Encoding utf8
} finally {Pop-Location}
