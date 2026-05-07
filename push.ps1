# 一行 push 到 GitHub
# 用法: ./push.ps1 "修正 X"
#       ./push.ps1            (用預設 commit message)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$patFile = ".git-pat.txt"
if (-not (Test-Path $patFile)) {
    Write-Error "找不到 $patFile，請建立並填入 GitHub PAT"
    exit 1
}

$pat = (Get-Content $patFile -First 1).Trim()
$url = "https://ZeroAlcoholic:$pat@github.com/ZeroAlcoholic/Rubiks_cube.git"
$msg = if ($args.Count -gt 0) { $args[0] } else { "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

# Stage 所有變更
git add -A
$status = git status --porcelain
if (-not $status) {
    Write-Host "沒有變更可 commit。" -ForegroundColor Yellow
    exit 0
}

# Commit
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
    Write-Error "commit 失敗"
    exit 1
}

# Push（PAT 不會印出）
git push $url main:main 2>&1 | ForEach-Object {
    $_ -replace [regex]::Escape($pat), '***PAT***'
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ 推送完成: $msg" -ForegroundColor Green
    Write-Host "  https://github.com/ZeroAlcoholic/Rubiks_cube" -ForegroundColor Gray
} else {
    Write-Error "push 失敗"
    exit 1
}
