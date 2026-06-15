# Envia vários comandos na MESMA conexão TCP e mostra cada resposta.
$ETX = [char]3
$enc = [Text.Encoding]::UTF8

$tcp = New-Object System.Net.Sockets.TcpClient
$tcp.Connect('127.0.0.1', 3434)
$stream = $tcp.GetStream()
$buf = New-Object byte[] 65536

function Read-Resposta($timeoutMs = 60000) {
    $total = ''
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
        if ($stream.DataAvailable) {
            $n = $stream.Read($buf, 0, $buf.Length)
            $total += $enc.GetString($buf, 0, $n)
            if ($total.Contains([char]3)) { break }
        }
        Start-Sleep -Milliseconds 100
    }
    return $total.TrimEnd([char]3)
}

# Banner
$banner = Read-Resposta 3000
Write-Output "BANNER: $($banner.Split("`n")[0])"

foreach ($cmd in @('NFE.SetAmbiente(1)', 'NFE.StatusServico')) {
    $bytes = $enc.GetBytes("$cmd`r`n.`r`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $resp = Read-Resposta
    $tpAmb = if ($resp -match 'tpAmb=(\d)') { $Matches[1] } else { '?' }
    $url = if ($resp -match 'URL: (\S+)') { $Matches[1] } else { '-' }
    $primeiraLinha = ($resp -split "`r?`n")[0]
    Write-Output "[$cmd] tpAmb=$tpAmb | URL=$url | $($primeiraLinha.Substring(0, [Math]::Min(70, $primeiraLinha.Length)))"
}

$tcp.Close()
