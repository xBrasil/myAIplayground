# Shared i18n helper for PowerShell scripts.
# Dot-source this file from install.ps1 / run.ps1:
#   . (Join-Path $PSScriptRoot "scripts\i18n.ps1")

$script:I18nStrings = @{}

function Initialize-I18n {
    param([string]$RepoRoot)

    $localesDir = Join-Path $RepoRoot "frontend\src\locales"
    $culture = (Get-UICulture).Name   # e.g. "pt-BR", "en-US"

    # Try exact match first, then language-prefix, then fallback to en-US
    $localeFile = Join-Path $localesDir "$culture.json"
    if (-not (Test-Path $localeFile)) {
        $lang = $culture.Split('-')[0]
        $candidate = Get-ChildItem $localesDir -Filter "$lang-*.json" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($candidate) {
            $localeFile = $candidate.FullName
        } else {
            $localeFile = Join-Path $localesDir "en-US.json"
        }
    }

    $json = Get-Content $localeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:I18nStrings = @{}
    $json.PSObject.Properties | ForEach-Object { $script:I18nStrings[$_.Name] = $_.Value }
}

function T {
    param(
        [string]$Key,
        [hashtable]$Params = @{}
    )
    $value = $script:I18nStrings[$Key]
    if (-not $value) { return $Key }
    foreach ($k in $Params.Keys) {
        $placeholder = "{{$k}}"
        $replacement = [string]$Params[$k]
        $value = $value.Replace($placeholder, $replacement)
    }
    return $value
}
