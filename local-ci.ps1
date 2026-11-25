# Runs the same checks as the CI workflow locally. Stops at the first failure.
# Usage: .\local-ci.ps1 [-Full]
#   -Full  build the installers (npm run tauri build) like CI does;
#          by default only the frontend is built (npm run build), which is enough for clippy and the tests.
param([switch]$Full)

function Invoke-Step {
    param([string]$Command, [string[]]$Arguments)
    Write-Host ""
    Write-Host "==> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed: $Command $($Arguments -join ' ')" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Invoke-Step "npm" @("install")
Invoke-Step "npm" @("run", "lint")
Invoke-Step "npm" @("test")
Invoke-Step "cargo" @("fmt", "--all", "--", "--check")
if ($Full) {
    Invoke-Step "npm" @("run", "tauri", "build")
} else {
    Invoke-Step "npm" @("run", "build")
}
Invoke-Step "cargo" @("clippy", "--all-targets", "--", "-D", "warnings")
Invoke-Step "cargo" @("test")

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
