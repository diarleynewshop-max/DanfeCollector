# Testa variações de terminador de comando contra o ACBrMonitorPLUS (porta 3434)

function Test-AcbrPayload($descricao, $payload) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.Connect('127.0.0.1', 3434)
        $stream = $tcp.GetStream()
        $buf = New-Object byte[] 8192
        $enc = [Text.Encoding]::GetEncoding('iso-8859-1')

        # Descarta o banner de boas-vindas
        Start-Sleep -Milliseconds 600
        if ($stream.DataAvailable) { [void]$stream.Read($buf, 0, 8192) }

        $cmd = $enc.GetBytes($payload)
        $stream.Write($cmd, 0, $cmd.Length)

        $total = ''
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($sw.ElapsedMilliseconds -lt 6000) {
            if ($stream.DataAvailable) {
                $n = $stream.Read($buf, 0, 8192)
                $total += $enc.GetString($buf, 0, $n)
                if ($total.Contains([char]3)) { break }
            }
            Start-Sleep -Milliseconds 100
        }

        if ($total) {
            Write-Output "[$descricao] => $($total -replace [char]3, '<ETX>')"
        } else {
            Write-Output "[$descricao] => SEM RESPOSTA (6s)"
        }
    } catch {
        Write-Output "[$descricao] => ERRO: $($_.Exception.Message)"
    } finally {
        $tcp.Close()
    }
}

$CRLF = "`r`n"
$ETX = [string][char]3

Test-AcbrPayload "CRLF + ponto + CRLF" "ACBr.Ativo$CRLF.$CRLF"
Test-AcbrPayload "ETX no final" "ACBr.Ativo$ETX"
Test-AcbrPayload "Apenas LF" "ACBr.Ativo`n"
Test-AcbrPayload "Apenas CR" "ACBr.Ativo`r"
Test-AcbrPayload "Sem terminador" "ACBr.Ativo"
