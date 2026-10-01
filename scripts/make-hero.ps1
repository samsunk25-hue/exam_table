# 대문 이미지 만들기: 원본 그림(hero-source.png)을 비율 그대로 잘라
#   apps/web/public/og-image.jpg (링크 미리보기 1200x630) — 시간표 제목 ~ 선생님 상반신·태블릿
#   apps/web/public/hero.jpg     (로그인 화면 960x504)     — 위와 같은 영역
# 실행: powershell -File scripts/make-hero.ps1 [원본 경로]
param([string]$Source = "$PSScriptRoot/../hero-source.png")

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $imgW = $src.Width; $imgH = $src.Height  # PowerShell 변수는 대소문자를 구분하지 않으므로 $w/$h와 다른 이름을 쓴다
  $out = Join-Path $PSScriptRoot '../apps/web/public'
  New-Item -ItemType Directory -Force $out | Out-Null

  # JPEG 품질 85 (PNG 대비 약 1/8 크기)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L

  # 원본 비율 기준 영역(x, y, 너비) → 출력 크기와 같은 비율로 잘라 저장
  function Save-Crop([double]$fx, [double]$fy, [double]$fw, [int]$outW, [int]$outH, [string]$name) {
    $x = [int]($imgW * $fx); $y = [int]($imgH * $fy)
    $w = [int]($imgW * $fw); $h = [int]($w * $outH / $outW)
    if ($y + $h -gt $imgH) { $h = $imgH - $y }
    $rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
    $bmp = New-Object System.Drawing.Bitmap $outW, $outH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $outW, $outH), $rect, [System.Drawing.GraphicsUnit]::Pixel)
    $path = Join-Path $out $name
    $bmp.Save($path, $codec, $params)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "saved $path ($outW x $outH, crop $x,$y ${w}x$h)"
  }

  Save-Crop 0.22 0.07 0.62 1200 630 'og-image.jpg'
  Save-Crop 0.22 0.07 0.62 960 504 'hero.jpg'
} finally {
  $src.Dispose()
}
