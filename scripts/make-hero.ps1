# 대문 이미지 만들기: 원본 그림의 가운데 윗부분(시간표 제목 ~ 선생님 상반신·태블릿)을 잘라
#   apps/web/public/og-image.jpg (링크 미리보기 1200x630)
#   apps/web/public/hero.jpg     (머리글·로그인 화면 960x504)
# 실행: powershell -File scripts/make-hero.ps1 [원본 경로]
param([string]$Source = "$PSScriptRoot/../hero-source.png")

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $W = $src.Width; $H = $src.Height
  # 원본 비율 기준: 가로 22%~84%, 세로 7%부터 (1.905:1 = 링크 미리보기 비율)
  $x = [int]($W * 0.22); $y = [int]($H * 0.07)
  $w = [int]($W * 0.62); $h = [int]($w / 1.905)
  if ($y + $h -gt $H) { $h = $H - $y }
  $crop = New-Object System.Drawing.Rectangle $x, $y, $w, $h

  $out = Join-Path $PSScriptRoot '../apps/web/public'
  New-Item -ItemType Directory -Force $out | Out-Null
  # JPEG 품질 85 (PNG 대비 약 1/8 크기)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L

  function Save-Resized([int]$outW, [int]$outH, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $outW, $outH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $outW, $outH), $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save($path, $codec, $params)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "saved $path ($outW x $outH)"
  }

  Save-Resized 1200 630 (Join-Path $out 'og-image.jpg')
  Save-Resized 960 504 (Join-Path $out 'hero.jpg')
} finally {
  $src.Dispose()
}
