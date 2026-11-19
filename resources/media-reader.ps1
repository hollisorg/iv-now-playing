# IV Now Playing media reader.
# Reads Windows' system media controls (what the Windows media flyout shows) and prints one JSON line
# per tick to stdout: every current media session with its title, artist, timing and cover file.
# Built-in Windows PowerShell and WinRT only: no modules, no network, read only.
# Usage: media-reader.ps1 <cover folder> [interval ms]
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw 'Windows media controls did not answer in time' }
  $task.Result
}

$artDir = $args[0]
if (-not $artDir) { $artDir = Join-Path $env:TEMP 'iv-now-playing-art' }
New-Item -ItemType Directory -Force -Path $artDir | Out-Null
$intervalMs = 1000
if ($args.Count -gt 1) { $intervalMs = [Math]::Max(250, [int]$args[1]) }

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$playingStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
$manager = Await ($managerType::RequestAsync()) ($managerType)
$artCache = @{}
$sha1 = New-Object Security.Cryptography.SHA1Managed

# WinRT streams come back to Windows PowerShell as bare COM objects, so turn them into a .NET stream
# through reflection (which can cast them) and copy that.
$inputStreamType = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@($inputStreamType))

function Save-Art($thumb) {
  try {
    $stream = Await ($thumb.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = $asStreamForRead.Invoke($null, @($stream))
    $buffer = New-Object System.IO.MemoryStream
    $chunk = New-Object byte[] 65536
    while ($buffer.Length -lt 8MB) {
      $got = $net.Read($chunk, 0, $chunk.Length)
      if ($got -le 0) { break }
      $buffer.Write($chunk, 0, $got)
    }
    $net.Dispose()
    if ($buffer.Length -eq 0 -or $buffer.Length -ge 8MB) { return '' }
    $bytes = $buffer.ToArray()
    $name = [BitConverter]::ToString($sha1.ComputeHash($bytes)).Replace('-', '').Substring(0, 20).ToLower() + '.img'
    $path = Join-Path $artDir $name
    if (-not (Test-Path $path)) { [IO.File]::WriteAllBytes($path, $bytes) }
    return $name
  } catch { return '' }
}

while ($true) {
  $tick = @{ ok = $true; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); current = ''; sessions = @() }
  try {
    $current = $manager.GetCurrentSession()
    if ($current) { $tick.current = $current.SourceAppUserModelId }
    $list = @()
    foreach ($s in $manager.GetSessions()) {
      try {
        $info = $s.GetPlaybackInfo()
        $timeline = $s.GetTimelineProperties()
        $props = Await ($s.TryGetMediaPropertiesAsync()) ($propsType)
        $playing = ($info.PlaybackStatus -eq $playingStatus)
        $dur = ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds
        $pos = $timeline.Position.TotalMilliseconds
        # Windows updates Position only now and then; add the time since its last update while playing.
        if ($playing -and $timeline.LastUpdatedTime.Year -gt 2000) {
          $since = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalMilliseconds
          if ($since -gt 0 -and $since -lt 3600000) { $pos += $since }
        }
        if ($dur -gt 0) { $pos = [Math]::Min($pos, $dur) }
        $artist = [string]$props.Artist
        if (-not $artist) { $artist = [string]$props.AlbumArtist }
        $key = "$($s.SourceAppUserModelId)|$($props.Title)|$artist|$($props.AlbumTitle)"
        $now = [Environment]::TickCount
        $cached = $artCache[$key]
        # Look again for a cover that was missing (apps often add it a moment after the song starts).
        if (-not $cached -or (-not $cached.name -and ($now - $cached.tried) -gt 3000)) {
          $art = ''
          if ($props.Thumbnail) { $art = Save-Art $props.Thumbnail }
          if ($artCache.Count -gt 200) { $artCache.Clear() }
          $artCache[$key] = @{ name = $art; tried = $now }
        }
        $list += @{
          app = [string]$s.SourceAppUserModelId
          title = [string]$props.Title
          artist = $artist
          album = [string]$props.AlbumTitle
          playing = $playing
          position = [int64][Math]::Max(0, $pos)
          duration = [int64][Math]::Max(0, $dur)
          art = $artCache[$key].name
        }
      } catch {}
    }
    $tick.sessions = $list
  } catch {
    $tick.ok = $false
    $tick.error = $_.Exception.Message
    try { $manager = Await ($managerType::RequestAsync()) ($managerType) } catch {}
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $tick -Compress -Depth 4))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $intervalMs
}
