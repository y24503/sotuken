<#
Downloads MediaPipe Pose JS + assets into this folder with multiple mirrors and TLS fix.
Usage: Run from Demo\download_pose.bat or directly.
#>
param()

$ErrorActionPreference = 'Stop'

# Ensure TLS1.2 for older PowerShell
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$version = '0.5.1675469242'
$bases = @(
  "https://cdn.jsdelivr.net/npm/@mediapipe/pose@${version}/",
  "https://fastly.jsdelivr.net/npm/@mediapipe/pose@${version}/",
  "https://unpkg.com/@mediapipe/pose@${version}/"
)
$targetDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Downloading MediaPipe Pose assets to" $targetDir

# Ensure directory exists
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

# Files required by MediaPipe Pose (JS + assets)
$files = @(
  'pose.js',
  'pose_solution_packed_assets_loader.js',
  'pose_solution_packed_assets.data',
  'pose_solution_simd_wasm_bin.wasm',
  'pose_solution_wasm_bin.js',
  'pose_solution_simd_wasm_bin.js',
  # Added model & graph assets
  'pose_landmark_full.tflite',
  'pose_landmark_heavy.tflite',
  'pose_landmark_lite.tflite',
  'pose_web.binarypb'
)

$failed = @()
foreach ($f in $files) {
    $dst = Join-Path $targetDir $f
    $ok = $false
    foreach ($b in $bases) {
        $src = $b + $f
        Write-Host "GET  " $src
        try {
            Invoke-WebRequest -Uri $src -OutFile $dst -UseBasicParsing -TimeoutSec 30
            if (Test-Path $dst -PathType Leaf) {
                $len = (Get-Item $dst).Length
                if ($len -gt 0) { $ok = $true; break }
            }
        } catch {
            Write-Warning "Failed: $src"
        }
    }
    if (-not $ok) { $failed += $f }
}

if ($failed.Count -gt 0) {
  Write-Warning ("Some files failed: " + ($failed -join ', '))
  Write-Host "You can also copy them manually from the npm package @mediapipe/pose@$version."
} else {
  Write-Host "All MediaPipe Pose files downloaded successfully."
}

Write-Host "Download completed. Reload your browser page."
