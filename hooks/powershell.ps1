# Engram shell hook — added by `engram init`
$env:ENGRAM_SESSION_ID = -join ((97..122) | Get-Random -Count 8 | % {[char]$_})

Set-PSReadLineOption -AddToHistoryHandler {
  param($command)
  $payload = @{
    type      = "command"
    content   = $command
    source    = (Get-Location).Path
    exitCode  = $LASTEXITCODE
    sessionId = $env:ENGRAM_SESSION_ID
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  } | ConvertTo-Json -Compress
  Start-Job -ScriptBlock {
    param($p, $port)
    $tcp = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $port)
    $stream = $tcp.GetStream()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($p + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $tcp.Close()
  } -ArgumentList $payload, 7842 | Out-Null
  return $true
}